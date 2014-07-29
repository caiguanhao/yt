yt
==

Get lastest videos of user subscriptions in a faster way. (using cookie)

**Why not use YouTube's APIv3?** The APIv3 does not provide a direct method
to do this. You have to get recent uploads of each subscription and sort them
by date manually. It is very inefficient.

## Command

If you installed `yt` globally, you can open your YouTube subscription videos
from terminal. Requires [livestreamer](https://github.com/chrippa/livestreamer)
and [VLC player](http://www.videolan.org/vlc/.
Currently works on Mac OS X and Linux.

```
pip install livestreamer
npm -g i yt
yt
```

By default, `yt` will store your cookie and cache file in `~/.config/yt/`.

Run `yt -h` for available command-line options.

## API

```js
var yt = require('yt');

// How to get cookie:
// 1. Open Google Chrome and right click the page and select Inspect Element.
// 2. Go to https://www.youtube.com/, log in if you don't have.
// 3. In Networks tab, click Documents and right click the first item in the
//    list and click Copy as cURL.
// 4. Copy the values of SID, HSID, SSID, LOGIN_INFO.
var cookie = {
  "SID": "",
  "HSID": "",
  "SSID": "",
  "LOGIN_INFO": ""
};

// Or you can directly assign the copied string to the cookie variable:
// var cookie = "curl 'https://www.youtube.com/' ... ";

// yt.subscription.get(pages <number/array>, cookie <object/string>)
// returns a Q promise;

yt.subscription.get(1, cookie).then(function(videos) {});

// or page 1 to 5:
yt.subscription.get([1,2,3,4,5], cookie).then(function(videos) {
  console.log(videos);
});
```

Example output:

```js
[ { duration: '3:33',
    live: false,
    verified: true,
    description: 'This is the way salad is supposed to evolve...',
    userurl: 'http://www.youtube.com/user/EpicMealTime',
    username: 'Epic Meal Time',
    url: 'http://www.youtube.com/watch?v=wfIAjuxbfr4',
    title: 'Poultry Salad - Epic Meal Time',
    time: '3 hours ago',
    views: '15,804 views' },
...
]
```
