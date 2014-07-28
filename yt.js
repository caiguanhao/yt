#!/usr/bin/env node

var Q          = require('q');
var events     = require('events');
var https      = require('https');
var libdata    = require('./data');
var entities   = require('entities');
var termMenu   = require('terminal-menu-2');
var htmlparser = require('htmlparser2');
var exec       = require('child_process').exec;
var spawn      = require('child_process').spawn;

var OPTIONS    = require('./getopts');
var COLUMNS    = process.stdout.columns || 80;
var ROWS       = process.stdout.rows || 24;
var COOKIE, MENU;

var colMax = COLUMNS - 4;
var rowMax = ROWS - 2;

var ITEMSPERPAGE = 16;

var RUNNING = {}, ITEMS = [];

var INDICATOR_ON = ' ◉ ', INDICATOR_OFF = ' ◯ ';

Q().
then(function() {
  ITEMS = libdata.readCache();
  makeMenu();
}).
then(function() {
  return libdata.checkConf();
}).
then(function(cookie) {
  COOKIE = cookie;
}).
then(function() {
  if (!MENU) process.stdout.write('Retrieving list of videos ... ');
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
  if (!arrayEquals(ITEMS, data)) {
    libdata.createCache(data);
    ITEMS = data;
    makeMenu();
  }
}).
catch(function(err) {
  if (MENU) {
    MENU.reset();
    MENU.close();
  }
  console.error(err.stack ? err.stack : err);
  process.exit(1);
});



var ytEvents = new events.EventEmitter();

ytEvents.on('start', function(index) {
  var url = ITEMS[index].url;
  if (MENU.items[index].label.slice(0, 3) === INDICATOR_ON) {
    return killall(RUNNING[url].pid);
  }
  MENU.items[index].label = INDICATOR_ON + MENU.items[index].label.slice(3);
  MENU._drawRow(index);
  // use --player-no-close to prevent video player exiting too early
  // vlc's --play-and-exit option does not work in Mac OS X
  // so we use verbose stderr to see when the video really ends
  var livestreamer = spawn('livestreamer', [
    '--player-no-close',
    url, OPTIONS.f,
    '--player-args', '--video-on-top {filename} --verbose 2',
    '--verbose-player'
  ]);
  livestreamer.stderr.on('data', function(chunk) {
    if (chunk.toString().indexOf('finished input') > -1) {
      if (!RUNNING[url]) return;
      killall(RUNNING[url].pid);
    }
  });
  livestreamer.on('exit', function() {
    ytEvents.emit('end', url);
  });
  RUNNING[url] = livestreamer;
});

ytEvents.on('end', function(url) {
  var index = -1;
  for (var i = 0; i < ITEMS.length; i++) {
    if (ITEMS[i].url === url) {
      index = i;
      break;
    }
  }
  if (index > -1) {
    MENU.items[index].label = INDICATOR_OFF + MENU.items[index].label.slice(3);
    MENU._drawRow(index);
  }
  delete RUNNING[url];
});

function killall(pid) {
  if (!pid) return;
  exec('pgrep -P ' + pid, function(error, stdout, stderr) {
    if (stdout) {
      var pids = stdout.trim().split('\n');
      pids.forEach(function(pid) {
        if (pid) process.kill(pid, 'SIGKILL');
      });
    }
    process.kill(pid, 'SIGKILL');
  });
}

function arrayEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
          url: 'http://www.youtube.com' + attribs.href,
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

function makeMenu() {
  if (Object.prototype.toString.call(ITEMS) !== '[object Array]') return;
  if (ITEMS.length === 0) return;

  var selected = -1;
  if (MENU) {
    selected = MENU.selected;
    MENU.reset();
    MENU.close();
  }
  MENU = termMenu({ width: colMax, fg: OPTIONS.fg, bg: OPTIONS.bg });
  MENU.reset();
  MENU.write('');
  var indLen = 1; // indicator length is 2 in `slice`, so distract 1
  for (var i = 0; i < Math.min(rowMax, ITEMS.length); i++) {
    var indicator = INDICATOR_OFF;
    if (RUNNING.hasOwnProperty(ITEMS[i].url)) indicator = INDICATOR_ON;
    var title = ITEMS[i].title;
    MENU.add(slice(indicator + pad(i + 1) + '. ' + title, colMax + indLen));
  }
  if (selected > -1) MENU.selected = selected;
  MENU.on('select', function (label, index) {
    ytEvents.emit('start', index);
  });
  MENU.createStream().pipe(process.stdout);
}
