var Q          = require('q');
var fs         = require('fs');
var path       = require('path');
var https      = require('https');
var entities   = require('entities');
var termMenu   = require('terminal-menu-2');
var htmlparser = require('htmlparser2');
var spawn      = require('child_process').spawn;

var COLUMNS    = process.stdout.columns || 80;
var CookieFile = path.join(getUserHome(), '.config', 'yt', 'cookie.json');
var COOKIE;

var INSTRUCTIONS = 'Follow these steps and then run this command again:\n' +
'1. Open Google Chrome and right click the page and select Inspect Element.\n' +
'2. Go to https://www.youtube.com/, log in if you don\'t have.\n' +
'3. In Networks tab, click Documents and right click the first item in the \n' +
'   list and click Copy as cURL.';

checkConf().
then(function(cookie) {
  COOKIE = cookie;
}).
then(function() {
  return request();
}).
then(function(res) {
  var data = JSON.parse(res.body);
  var html = data.content_html;
  return analyze(html);
}).
then(function(data) {
  makeMenu(data);
}).
catch(console.error);

function getUserHome() {
  return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
}

function mkdirp(dirpath) {
  dirpath.split(/[\/\\]/g).reduce(function(parts, part) {
    parts += part + '/';
    try {
      fs.mkdirSync(path.resolve(parts));
    } catch(e) {}
    return parts;
  }, '');
}

function isStr(what) {
  return what && (typeof what === 'string');
}

function readConf() {
  try {
    var cookie = JSON.parse(fs.readFileSync(CookieFile).toString());
    var sid = cookie.SID;
    var hsid = cookie.HSID;
    var ssid = cookie.SSID;
    var login_info = cookie.LOGIN_INFO;
    if (!isStr(sid) || !isStr(hsid) || !isStr(ssid) || !isStr(login_info)) {
      throw undefined;
    }
    return 'SID=' + sid + '; HSID=' + hsid + '; SSID=' + ssid +
      '; LOGIN_INFO=' + login_info;
  } catch(e) {
    return undefined;
  }
}

function createConf(object) {
  var dir = path.dirname(CookieFile);
  if (!fs.existsSync(dir)) {
    mkdirp(dir);
  } else if (!fs.statSync(dir).isDirectory()) {
    fs.unlinkSync(dir);
    mkdirp(dir);
  }
  fs.writeFileSync(
    CookieFile,
    JSON.stringify(object, undefined, 2),
    { mode: 0600 }
  );
}

function checkConf() {
  var conf = readConf();
  if (conf) {
    return Q(conf);
  } else {
    return getClipboard().then(function(content) {
      var data = content.match(/\b(SID|HSID|SSID|LOGIN_INFO)=(.+?);/g);
      if (!data || data.length !== 4) throw INSTRUCTIONS;
      var conf = {};
      for (var i = 0; i < data.length; i++) {
        var d = data[i].split('=', 2);
        conf[d[0]] = d[1].slice(0, -1);
      }
      createConf(conf);
      return checkConf();
    });
  }
}

function getClipboard() {
  var deferred = Q.defer();
  var pbpaste = spawn('pbpaste');
  var data = '';
  pbpaste.stdout.on('data', function(chunk) {
    data += chunk;
  });
  pbpaste.stdout.on('end', function() {
    deferred.resolve(data);
  });
  pbpaste.on('exit', function(code) {
    deferred.reject('Exit with code: '+ code);
  });
  pbpaste.on('error', function(e) {
    deferred.reject(e.message);
  });
  return deferred.promise;
}

function request() {
  var deferred = Q.defer();
  var reqpath = '/feed_ajax?feed_name=subscriptions&action_load_system_feed=1';
  reqpath += '&paging=1';
  var req = https.request({
    host: 'www.youtube.com',
    port: 443,
    path: reqpath,
    method: 'GET',
    headers: {
      cookie: COOKIE
    }
  }, function(res) {
    res.setEncoding('utf8');
    var body = '';
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
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
  var ret = [];
  var deferred = Q.defer();
  var parser = new htmlparser.Parser({
    onopentag: function(name, attribs) {
      if (name === 'a' && attribs.title && /^\/watch/.test(attribs.href)) {
        ret.push({
          href: attribs.href,
          title: attribs.title
        });
      }
    },
    ontext: function(text) {

    },
    onend: function(tagname) {
      deferred.resolve(ret);
    }
  });
  parser.write(content);
  parser.end();
  return deferred.promise;
}

function slice(str, len) {
  str = entities.decodeHTML(str);
  return str.slice(0, len - (str.match(/[^\u0000-\u00ff]/g) || '').length);
}

function makeMenu(items) {
  var width = COLUMNS - 4;
  var menu = termMenu({ width: width });
  menu.reset();
  menu.write('');
  for (var i = 0; i < items.length; i++) {
    menu.add(slice(items[i].title, width));
  };
  menu.on('select', function (label, index) {
    var url = 'http://www.youtube.com' + items[index].href;
    spawn('livestreamer', [ url, '360p' ]);
  });
  menu.createStream().pipe(process.stdout);
}
