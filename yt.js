#!/usr/bin/env node

var Q          = require('q');
var fs         = require('fs');
var path       = require('path');
var https      = require('https');
var entities   = require('entities');
var termMenu   = require('terminal-menu-2');
var htmlparser = require('htmlparser2');
var spawn      = require('child_process').spawn;

var COLUMNS    = process.stdout.columns || 80;
var ROWS       = process.stdout.rows || 24;
var YTDir      = path.join(getUserHome(), '.config', 'yt');
var CookieFile = path.join(YTDir, 'cookie.json');
var CacheFile  = path.join(YTDir, 'cache.json');
var COOKIE, CACHE, Menu;

var colMax = COLUMNS - 4;
var rowMax = ROWS - 2;

var ITEMSPERPAGE = 16;

var INSTRUCTIONS = 'Follow these steps and then run this command again:\n' +
'1. Open Google Chrome and right click the page and select Inspect Element.\n' +
'2. Go to https://www.youtube.com/, log in if you don\'t have.\n' +
'3. In Networks tab, click Documents and right click the first item in the \n' +
'   list and click Copy as cURL.';

Q().
then(function() {
  CACHE = readCache();
  if (CACHE) makeMenu(CACHE);
}).
then(function() {
  return checkConf();
}).
then(function(cookie) {
  COOKIE = cookie;
}).
then(function() {
  var pages = Math.ceil(rowMax / ITEMSPERPAGE);
  var requests = Array.apply(undefined, {
    length: pages
  }).map(Function.call, function(i) {
    return request(i + 1);
  });
  return Q.all(requests);
}).
then(function(res) {
  var html = '';
  for (var i = 0; i < res.length; i++) {
    html += res[i].body;
  }
  return analyze(html);
}).
then(function(data) {
  if (!arrayEquals(CACHE, data)) {
    createCache(data);
    makeMenu(data);
  }
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

function arrayEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CacheFile).toString());
  } catch(e) {
    return undefined;
  }
}

function createFile(filepath, data) {
  if (!fs.existsSync(YTDir)) {
    mkdirp(YTDir);
  } else if (!fs.statSync(YTDir).isDirectory()) {
    fs.unlinkSync(YTDir);
    mkdirp(YTDir);
  }
  fs.writeFileSync(
    filepath,
    JSON.stringify(data, undefined, 2),
    { mode: 0600 }
  );
}

function createConf(data) {
  createFile(CookieFile, data);
}

function createCache(data) {
  createFile(CacheFile, data);
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

function request(page) {
  var deferred = Q.defer();
  var reqpath;
  if (page < 2) {
    reqpath = '/feed/subscriptions';
  } else {
    reqpath = '/feed_ajax?feed_name=subscriptions&action_load_system_feed=1';
    reqpath += '&paging=' + ((page - 1) * ITEMSPERPAGE);
  }
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

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function makeMenu(items) {
  if (Menu) {
    Menu.reset();
    Menu.close();
  }
  Menu = termMenu({ width: colMax });
  Menu.reset();
  Menu.write('');
  for (var i = 0; i < Math.min(rowMax, items.length); i++) {
    Menu.add(slice(pad(i + 1) + '. ' + items[i].title, colMax));
  }
  Menu.on('select', function (label, index) {
    var url = 'http://www.youtube.com' + items[index].href;
    // use --player-no-close to prevent video player exiting too early
    spawn('livestreamer', [ '--player-no-close', url, '360p' ]);
  });
  Menu.createStream().pipe(process.stdout);
}
