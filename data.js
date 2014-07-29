var Q          = require('q');
var fs         = require('fs');
var path       = require('path');
var spawn      = require('child_process').spawn;

var YTDir      = path.join(getUserHome(), '.config', 'yt');
var CookieFile = path.join(YTDir, 'cookie.json');
var CacheFile  = path.join(YTDir, 'cache.json');

var INSTRUCTIONS = 'No cookie found! Please follow these steps:\n' +
'1. Open Google Chrome and right click the page and select Inspect Element.\n' +
'2. Go to https://www.youtube.com/, log in if you don\'t have.\n' +
'3. In Networks tab, click Documents and right click the first item in the \n' +
'   list and click Copy as cURL.\n' +
'4. Re-run this command and it will read the contents of your clipboard.';

module.exports = {
  readCache: readCache,
  checkConf: checkConf,
  createCache: createCache
};

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
    return {
      SID: sid,
      HSID: hsid,
      SSID: ssid,
      LOGIN_INFO: login_info
    };
  } catch(e) {
    return {};
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
  if (typeof conf === 'object' && Object.keys(conf).length > 0) {
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
  var cb = {
    darwin: [ 'pbpaste' ],
    linux: [ 'xclip', [ '-selection', 'clipboard', '-out' ] ]
  }[ process.platform ];
  if (!cb) return Q.reject('No clipboard command for your OS!');
  var deferred = Q.defer();
  var clipboard = spawn.apply(undefined, cb);
  var data = '';
  clipboard.stdout.on('data', function(chunk) {
    data += chunk;
  });
  clipboard.stdout.on('end', function() {
    deferred.resolve(data);
  });
  clipboard.on('exit', function(code) {
    if (code) deferred.reject('Exit with code: '+ code);
  });
  clipboard.on('error', function(e) {
    deferred.reject('Failed to read clipboard. Make sure you have access to ' +
      'command `' + cb[0] + '`.');
  });
  return deferred.promise;
}
