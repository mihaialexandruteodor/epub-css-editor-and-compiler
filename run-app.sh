#!/bin/bash
export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin;
cd '/Users/frosty-bun/Documents/repos/epub-css-editor-and-compiler/'
npm start &
sleep 3
open http://localhost:3000
