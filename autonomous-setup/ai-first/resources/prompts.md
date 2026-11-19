# The use case: prompts

The hands-on part of the workshop, on your copy of the Excalidraw case study. Paste each prompt as is and press
Enter. The `<angle brackets>` are the only parts to fill in. The workshop site has the same prompts, with what you
should see and what to do if something's off: https://eli-w-king.github.io/ai-first-design-workshop/

Everything happens in the Agents window, starting in the chat where you ran the setup, on GPT-6.2 Sol at High effort,
Interactive mode and Allow all.

## 1. Open it on localhost

```text
Now open my Excalidraw case study. Move this chat there, run it on localhost and show it to me in the integrated browser.
```

While it loads, read `workshop/brief.md` in your copy: fictional user testing on the toolbar.

## 2. Mark Up a screenshot, then the quick change

In the integrated browser, use **Add to Chat**, **Add Area Screenshot to Chat** and drag around the toolbar. Click the
screenshot in the chat input, choose **Mark Up**, circle what confused testers, add an arrow, a note with your idea
and a crop, then **Done**.

```text
Here's my marked-up screenshot. Use it and the user testing notes in workshop/brief.md to fix what confused people about the toolbar. Make the change on a new branch. Keep it small, just the toolbar change, so I can see it right away. Don't test drawing yet, we'll do that next.
```

## 3. Test it in the browser

```text
Draw a few shapes in the integrated browser to test it. If something's broken, find the cause, fix it, and show me a shape drawn after the fix. Then commit the toolbar change and the fix.
```

## 4. Parallel sessions

Read `workshop/pm-follow-up.md` (fictional): the PM team wants four very different toolbars.

```text
The PM team came back with workshop/pm-follow-up.md. Use the autonomous-variations skill to build the four toolbars it asks for. Start four sessions under this one, one per direction. Each one starts from this branch, works on its own branch, adds only its own toolbar file and keeps the canvas clear. When all four are done, put them together in one lab I can switch between in the integrated browser, and give me the link.
```

## 5. Steer and queue while they build

Open one of the four sessions, type this, then choose **Steer with Message** from the Send button's menu:

```text
Give every button a tooltip with its name and keyboard shortcut.
```

Open another one, type this, then choose **Add to Queue**:

```text
When you're done, tell me in three bullets what makes this toolbar different.
```

When the lab is ready, press `[` and `]` to switch toolbars, and pick a favorite.

## 6. Ship the favorite

```text
My favorite is <name>. Make it the default toolbar. Then, in parallel where you can: use the autonomous-demos skill to record a short narrated demo video of drawing a few shapes with it, open a pull request in my repo with all four variations, fill in the page for everyone in review/ with the four variations, the video and the pull request, and turn on GitHub Pages. When the video and the page are in the pull request, merge it, wait for Pages to publish, and give me the links.
```

## 7. A page for everyone

```text
Open the pull request, the video, my live Excalidraw and the page for everyone.
```

## On your own work

The same steps work on your own projects. Keep unreleased work off public sites: a GitHub Pages site from a personal
repo is public. The workshop site has a version of each prompt for your own work.
