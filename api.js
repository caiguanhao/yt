var Q          = require('q');
var https      = require('https');
var entities   = require('entities');
var htmlparser = require('htmlparser2');

var itemsPerPage = 16;

module.exports = {
  subscription: {
    get: get,
    request: request,
    analyze: analyze,
    itemsPerPage: itemsPerPage
  }
};

function get(pages, _cookie) {
  var promise, cookie = parseCookie(_cookie);
  if (Object.prototype.toString.call(pages) === '[object Array]') {
    promise = Q.all(pages.map(function(page) {
      return request(page, cookie);
    })).then(function(res) {
      var html = '';
      for (var i = 0; i < res.length; i++) {
        html += res[i].body;
      }
      return html;
    });
  } else {
    promise = request(pages, cookie).then(function(res) {
      return res.body;
    });
  }
  return promise.then(function(html) {
    return analyze(html);
  });
}

function parseCookie(content) {
  if (typeof content !== 'string') return content;
  var data = content.match(/\b(SID|HSID|SSID|LOGIN_INFO)=(.+?);/g);
  if (!data || data.length !== 4) return {};
  var cookie = {};
  for (var i = 0; i < data.length; i++) {
    var d = data[i].split('=', 2);
    cookie[d[0]] = d[1].slice(0, -1);
  }
  return cookie;
}

function cookieString(cookies) {
  var ret = '';
  if (typeof cookies !== 'object') return ret;
  for (var cookie in cookies) {
    ret += cookie + '=' + cookies[cookie] + ';'
  }
  return ret;
}

function request(page, cookie) {
  var deferred = Q.defer();
  var reqpath;
  if (typeof page !== 'number') page = 1;
  if (page < 2) {
    reqpath = '/feed/subscriptions';
  } else {
    reqpath = '/feed_ajax?feed_name=subscriptions&action_load_system_feed=1';
    reqpath += '&paging=' + Math.floor((page - 1) * itemsPerPage);
  }
  var req = https.request({
    host: 'www.youtube.com',
    port: 443,
    path: reqpath,
    method: 'GET',
    headers: {
      cookie: cookieString(cookie)
    }
  }, function(res) {
    res.setEncoding('utf8');
    var body = '';
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      if (page >= 2) {
        body = JSON.parse(body).content_html;
      }
      deferred.resolve({
        headers: res.headers,
        body: body
      });
    });
  });
  req.on('error', function (err) {
    deferred.reject(err);
  });
  req.end();
  return deferred.promise;
}

function analyze(content) {
  var ret = [], feedItem = -1;
  var isDuration = 0, isUserName = 0, isMetaData = 0, isDescription = 0;
  var deferred = Q.defer();
  var parser = new htmlparser.Parser({
    onopentag: function(name, attribs) {
      var hasClass = function(classname) {
        return attribs.class && attribs.class.indexOf(classname) > -1;
      };
      if (name === 'a' && attribs.title && /^\/watch/.test(attribs.href)) {
        ret[feedItem].url = 'http://www.youtube.com' + attribs.href;
        ret[feedItem].title = attribs.title;
      } else if (hasClass('yt-channel-title-icon-verified')) {
        ret[feedItem].verified = true;
      } else if (hasClass('yt-badge-live')) {
        ret[feedItem].live = true;
      } else if (hasClass('video-time')) {
        isDuration = 1;
      } else if (hasClass('yt-user-name')) {
        isUserName = 1;
        ret[feedItem].userurl = 'http://www.youtube.com' + attribs.href;
      } else if (name === 'div' && hasClass('yt-lockup-meta')) {
        isMetaData = 1;
      } else if (isMetaData > 0 && name === 'li') {
        isMetaData++;
      } else if (name === 'div' && hasClass('yt-lockup-description')) {
        isDescription = 1;
      } else if (name === 'li' && hasClass('feed-item-container')) {
        feedItem++;
        ret[feedItem] = {
          duration: '',
          live: false,
          verified: false,
          description: ''
        };
      }
    },
    onclosetag: function(name) {
      if (isMetaData && name === 'div') {
        isMetaData = 0;
      } else if (isDescription && name === 'div') {
        ret[feedItem].description = ret[feedItem].description.trim();
        isDescription = 0;
      }
    },
    ontext: function(text) {
      text = text.trim();
      if (isDuration) {
        ret[feedItem].duration = text;
        isDuration = 0;
      } else if (isUserName) {
        ret[feedItem].username = text;
        isUserName = 0;
      } else if (isMetaData) {
        var key = {
          2: 'time',
          4: 'views'
        }[isMetaData];
        if (key) {
          ret[feedItem][key] = text;
          isMetaData++;
        }
      } else if (isDescription) {
        ret[feedItem].description += entities.decodeHTML(text) + ' ';
      }
    },
    onend: function(tagname) {
      deferred.resolve(ret);
    }
  });
  parser.write(content);
  parser.end();
  return deferred.promise;
}
