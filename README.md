# astra

A Reddit client that runs in the browser, with more features that you will need!

## Files

- `index.html` - this is obvious
- `styles.css` - all the things that make the ui look nice
- `app.js` - ui and settings
- `api.js` - requests to the apis and caching
- `md.js` - markdown renderer

## Running

Just run it in a static HTTP server:

    python3 -m http.server 8000


## Signing in

You can browse without an account. To sign in:

1. Create an "installed app" at reddit.com/prefs/apps.
2. In Astra, open Settings > account > How? and copy the redirect URI into the app's redirect uri field.
3. Paste the app's client ID into Settings > account and sign in.

## Archives and deleted content

Turn on Arctic Shift and/or PullPush in Settings > sources to see archived copies of removed content.

## Gestures

Swipe a post right to upvote (or save if signed out) and further to save. Swipe left to hide and further for more.

Swipe a comment right to upvote and further to downvote. Swipe left to reply and further to save.

Gestures can be turned off in Settings > content.

## Keys

j and k move through posts, Enter opens one, h and l switch panels, u upvotes, s saves, x hides, r refreshes, / searches.

## Routes

    #/                    home
    #/r/name/sort         subreddit
    #/u/name/tab          user
    #/comments/id         thread
    #/search?q=text       search
    #/removed/name        removed posts in a subreddit
    #/saved  #/inbox  #/messages
