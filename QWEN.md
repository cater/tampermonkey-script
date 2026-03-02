# Auto Read - Tampermonkey Userscript

## Project Overview

This is a **Tampermonkey userscript** designed to automatically read and interact with posts on the **Linux.do** community forum. The script provides automation for:

- **Auto-scrolling** through unread posts with smooth scrolling animation
- **Auto-liking** posts with randomized intervals (up to 20 likes per day)
- **Navigation** between unread posts automatically
- **Error handling** with retry logic for failed page loads
- **Persistent state management** using localStorage

### Key Technologies
- **JavaScript** (ES6+ with modern syntax)
- **Tampermonkey API** for userscript functionality
- **Tailwind CSS** (via CDN) for UI styling
- **localStorage** for state persistence
- **requestAnimationFrame** for smooth scrolling performance

### Architecture
- **StateManager**: Handles local storage and state initialization
- **AutoReader**: Core business logic class managing reading, liking, and navigation
- **CONFIG**: Centralized configuration object for all constants
- **Modular design** with clear separation of concerns

---

## Installation & Usage

### Prerequisites
1. Install **Tampermonkey** browser extension (Chrome, Firefox, Edge, etc.)
2. Access to **Linux.do** community forum

### Installation Steps
1. Open Tampermonkey dashboard
2. Create new userscript
3. Copy the entire content of `main.js` into the editor
4. Save and enable the script

### Usage
1. Navigate to `https://linux.do/unseen` (unread posts page)
2. Click **"开始阅读"** (Start Reading) button in the bottom-left control panel
3. The script will automatically:
   - Fetch unread post links
   - Open and scroll through each post
   - Mark posts as read
   - Navigate to the next unread post
4. Optional: Enable **"启用点赞"** (Enable Like) to auto-like posts (max 20/day)

---

## Configuration

The script uses a centralized `CONFIG` object for all configurable values:

```javascript
const CONFIG = {
    BASE_URL: 'https://linux.do',          // Base URL
    LIKE_LIMIT: 20,                        // Daily like limit
    MAX_RETRIES: 3,                        // Max error retries
    SCROLL_OPTIONS: {                      // Scroll settings
        speed: 50,                         // Pixels per frame
        interval: 100                      // Milliseconds between frames
    },
    LIKE_INTERVAL: {                       // Like timing
        min: 2000,                         // Min delay (ms)
        max: 5000                          // Max delay (ms)
    },
    UPDATE_INTERVAL: 500                   // Status update interval (ms)
};
```

**To modify**: Edit values directly in `main.js` before installing.

---

## Features

### Core Functionality
- ✅ **Auto-scroll**: Smooth scrolling through posts using `requestAnimationFrame`
- ✅ **Auto-navigation**: Automatically moves to next unread post when finished
- ✅ **Persistent state**: Remembers reading progress across page reloads
- ✅ **Error recovery**: Retries failed page loads up to 3 times
- ✅ **Daily like limit**: Tracks and enforces 20 likes per day limit

### UI Controls
Located in bottom-left corner of the page:
- **开始阅读 / 停止阅读** - Toggle auto-reading
- **启用点赞 / 禁用点赞** - Toggle auto-liking
- **重置列表** - Reset unread list and state

### Status Panel
Displays real-time information in top-left corner:
- Reading status (running/stopped)
- Like status (enabled/disabled)
- Today's like count (X/20)
- Remaining unread posts
- Error retry count

---

## Development

### Code Structure
```
main.js
├── CONFIG (constants)
├── StateManager class
│   ├── initState()
│   ├── loadFromStorage()
│   ├── saveToStorage()
│   └── resetLikeCounter()
└── AutoReader class
    ├── init()
    ├── handleRoute()
    ├── fetchUnseenLinks()
    ├── openNextTopic()
    ├── processCurrentPage()
    ├── startSmoothScroll()
    ├── runAutoLike()
    ├── handleError()
    ├── resetState()
    ├── createControlPanel()
    └── updateStatus()
```

### Key Implementation Details

**Smooth Scrolling**
```javascript
// Uses requestAnimationFrame for 60fps smooth scrolling
const scrollStep = () => {
    window.scrollBy(0, scrollSpeed);
    // Continue until bottom element is reached
    this.state.scrollTimer = requestAnimationFrame(scrollStep);
};
```

**Auto-Liking with Random Intervals**
```javascript
// Random delay between likes to appear more human-like
const randomDelay = Math.random() * (max - min) + min;
setTimeout(() => this.runAutoLike(), randomDelay);
```

**State Persistence**
```javascript
// All state saved to localStorage for persistence
localStorage.setItem('autoReadState', JSON.stringify(this));
localStorage.setItem('likeCount', count);
localStorage.setItem('likeTimestamp', timestamp);
```

---

## Browser Compatibility

Tested and works with:
- ✅ Chrome (with Tampermonkey)
- ✅ Firefox (with Tampermonkey)
- ✅ Edge (with Tampermonkey)
- ✅ Other browsers supporting Tampermonkey extension

---

## License

**MIT License** - See header comment in `main.js` for details.

---

## Author

**XinSong** - https://blog.warhut.cn

---

## Notes

- This script is **exclusively for Linux.do** community
- The `@match` directive restricts execution to `https://linux.do/*` only
- Uses `unsafeWindow` for direct DOM access
- Requires Tailwind CSS CDN for styling the control panel
- State is stored in browser's `localStorage` and persists across sessions
- Daily like counter resets after 24 hours automatically

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Script not loading | Ensure Tampermonkey is enabled and script is installed correctly |
| Controls not visible | Check if you're on `linux.do` domain (script is domain-restricted) |
| Not scrolling | Verify you're on a post detail page with `article[data-post-id]` elements |
| Like limit reached | Wait 24 hours for counter to reset, or clear `likeCount` from localStorage |
| Error retries exceeded | Use "重置列表" button to reset state and start fresh |

---

## Future Enhancements (Potential)

- [ ] Add pause/resume functionality
- [ ] Customizable scroll speed via UI
- [ ] Export/import unread list
- [ ] Multiple reading modes (fast/slow)
- [ ] Sound notifications on completion
- [ ] Dark mode support for controls
