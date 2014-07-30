#!/usr/bin/env node

var Q        = require('q');
var open     = require('open');
var events   = require('events');
var https    = require('https');
var libapi   = require('./api');
var libdata  = require('./data');
var termMenu = require('terminal-menu-2');
var exec     = require('child_process').exec;
var spawn    = require('child_process').spawn;

var OPTIONS  = require('./getopts');
var COLUMNS  = process.stdout.columns || 80;
var ROWS     = process.stdout.rows || 24;
var colMax   = COLUMNS - 4;
var rowMax   = ROWS - 2;

var MENU, RUNNING = {}, ITEMS = [], HASH;
var INDICATOR_ON = ' ◉ ', INDICATOR_OFF = ' ◯ ';
var VIDEO_TO_START = 'Play this video', VIDEO_TO_STOP = 'Stop this video';

Q().
then(function() {
  ITEMS = libdata.readCache('subscriptions');
  HASH = libdata.readCache('hash');
  makeMenu();
}).
then(function() {
  return libdata.checkCookie();
}).
then(function(cookie) {
  if (!MENU) process.stdout.write('Retrieving list of videos ... ');
  var pagesNeeded = Math.ceil(rowMax / libapi.subscription.itemsPerPage);
  return libapi.subscription.get(serial(pagesNeeded), cookie);
}).
then(function(data) {
  var hash = cacheHash(data);
  libdata.saveCache(data, 'subscriptions');
  libdata.saveCache(hash, 'hash');
  ITEMS = data;
  if (HASH !== hash) {     // if there are new videos, update menu
    if (!MENU || !MENU.detailsPage) { // update menu if we are not on details page
      makeMenu();
    }
  }
}).
catch(function(err) {
  error(err);
});

// events

var ytEvents = new events.EventEmitter();

ytEvents.on('start', function(index) {
  var url = ITEMS[index].url;
  if (MENU.detailsPage) {
    if (MENU.items[0].label === VIDEO_TO_STOP) {
      return killall(RUNNING[url].pid);
    }
    MENU.items[0].label = VIDEO_TO_STOP;
    MENU._drawRow(0);
  } else {
    if (MENU.items[index].label.slice(0, 3) === INDICATOR_ON) {
      return killall(RUNNING[url].pid);
    }
    MENU.items[index].label = INDICATOR_ON + MENU.items[index].label.slice(3);
    MENU._drawRow(index);
  }
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
  livestreamer.on('error', function(e) {
    error('Make sure you have access to command `livestreamer`.');
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
    if (MENU.detailsPage) {
      MENU.items[0].label = VIDEO_TO_START;
      MENU._drawRow(0);
    } else {
      MENU.items[index].label = INDICATOR_OFF + MENU.items[index].label.slice(3);
      MENU._drawRow(index);
    }
  }
  delete RUNNING[url];
});

function error(err) {
  if (MENU) {
    MENU.reset();
    MENU.close();
  }
  console.error(err.stack ? err.stack : err);
  process.kill();
}

// serial(2) = [1, 2]  //  serial(5) = [1, 2, 3, 4, 5]
function serial(n) {
  return Array.apply(undefined, { length: n }).map(Function.call, function(i) {
    return i + 1;
  });
}

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

function cacheHash(items) {
  var text = items.map(function(item) {
    return item.url;
  }).join('\n');
  var shasum = require('crypto').createHash('sha1');
  shasum.update(text);
  return shasum.digest('hex');
}

// split('一a二b三c四五六七', 3) = ["一a", "二b", "三c", "四", "五", "六", "七"]
function split(str, len) {
  if (len < 1) len = 1;
  var chunks = [];
  while (str) {
    var s = '', c = 0;
    for (var i = 0; str[i] && i < len - c; i++) {
      if (/[^\u0000-\u00ff]/.test(str[i])) c++;
      if (i + 1 <= len - c) s += str[i];
    }
    chunks.push(s);
    str = str.slice(s.length);
  }
  return chunks;
}

function slice(str, len) {
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
    var duration = ITEMS[i].duration || '';
    if (duration && duration.length === 4) duration = '0' + duration;
    if (duration) duration = '[' + duration + '] ';
    var text = indicator + pad(i + 1) + '. ' + duration + title;
    MENU.add(slice(text, colMax + indLen));
  }
  if (selected > -1) MENU.selected = selected;
  MENU.on('select', function (label, index) {
    ytEvents.emit('start', index);
  });
  MENU.createStream().pipe(process.stdout);
}

function makeDetailsPage() {
  if (MENU) {
    selected = MENU.selected;
    MENU.reset();
    MENU.close();
  }
  var blankLines = rowMax;
  var ITEM = ITEMS[selected];
  MENU = termMenu({ width: colMax, fg: OPTIONS.fg, bg: OPTIONS.bg });
  MENU.detailsPage = true;
  MENU.reset();

  MENU.write('Title:\n');
  var title = split(ITEM.title, colMax - 2);
  title.forEach(function(line) {
    MENU.write(line + '\n');
  });
  MENU.write('\n');
  blankLines -= title.length + 2;

  var username = ITEM.username;
  if (ITEM.verified) username += ' (verified)'
  MENU.write('By: ' + username + '\n');
  MENU.write('\n');
  blankLines -= 2;

  MENU.write('Description:\n');
  var description = split(ITEM.description || '(none)', colMax - 2);
  description.forEach(function(line) {
    MENU.write(line + '\n');
  });
  MENU.write('\n');
  blankLines -= description.length + 2;

  var itemurl = split('URL: ' + ITEM.url, colMax - 2);
  itemurl.forEach(function(line) {
    MENU.write(line + '\n');
  });
  MENU.write('\n');
  blankLines -= itemurl.length + 1;

  if (RUNNING.hasOwnProperty(ITEM.url)) {
    MENU.add(VIDEO_TO_STOP);
  } else {
    MENU.add(VIDEO_TO_START);
  }
  MENU.add('Open this video in web browser');
  MENU.write('\n');
  blankLines -= 3;

  blankLines -= 1;  // last line

  for (var i = 0; i < blankLines; i++) {
    MENU.write('\n');
  }

  MENU.write(ITEM.time + ' - ' + (ITEM.views || 'no views') + '\n');

  var url = ITEM.url;
  MENU.on('select', function (label, index) {
    if (index === 0) {
      var i = 0
      for (; i < ITEMS.length; i++) {
        if (ITEMS[i].url === url) {
          break;
        }
      }
      ytEvents.emit('start', i);
    } else if (index === 1) {
      open(url);
    }
  });
  MENU.createStream().pipe(process.stdout);
}

process.stdin.on('data', function(buf) {
  if (!MENU) return;
  var codes = [].join.call(buf, '.');
  var selected;
  if (MENU.detailsPage && codes === '27.91.68') {             // left
    selected = MENU._selected;
    MENU.reset();
    MENU.close();
    makeMenu();
    if (selected > -1) MENU.selected = selected;
  } else if (!MENU.detailsPage && codes === '27.91.67') {      // right
    selected = MENU.selected;
    makeDetailsPage();
    MENU._selected = selected;
  }
});
