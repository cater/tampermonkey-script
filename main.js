// ==UserScript==
// @name         Auto Read (Linux.do Only)
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  自动刷阅读回复，仅支持Linux.do社区
// @author       XinSong(https://blog.warhut.cn)自
// @match        https://linux.do/*
// @grant        unsafeWindow
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=linux.do
// @require      https://cdn.tailwindcss.com
// ==/UserScript==

(() => {
    'use strict';
    // 挂载全局对象（避免作用域污染）
    const { document, window } = unsafeWindow;

    // 配置中心（常量集中管理）
    const CONFIG = {
        BASE_URL: 'https://linux.do',          // 基础URL
        ENABLE_LOG: true,                    // 是否输出调试日志
        AUTO_CLICK_BACK_BUTTON: false,       // 是否自动点击“返回上一个未读帖子”按钮
        LIKE_LIMIT: 20,                      // 每日点赞上限
        MAX_RETRIES: 3,                      // 错误页面最大重试次数
        PAGE_READY_RETRIES: 8,              // 页面内容未就绪时重试次数
        PAGE_READY_INTERVAL: 800,           // 页面内容重试间隔（毫秒）
        SCROLL_OPTIONS: {                    // 滚动配置
            speed: 50,                       // 滚动速度（像素/次）
            interval: 100,                   // 滚动间隔（毫秒）
        },
        LIKE_INTERVAL: {                     // 点赞间隔配置
            min: 2000,                       // 最小间隔（毫秒）
            max: 5000                        // 最大间隔（毫秒）
        },
        UPDATE_INTERVAL: 500                // 状态更新间隔（毫秒）
    };

    /**
     * 状态管理类
     * 负责本地存储管理和状态初始化
     */
    class StateManager {
        constructor() {
            this.initState();          // 初始化默认状态
            this.loadFromStorage();    // 从本地存储加载状态
        }

        // 初始化默认状态
        initState() {
            this.isReading = false;        // 是否正在阅读
            this.isLiking = false;         // 是否启用自动点赞
            this.errorRetries = 0;         // 错误页面重试次数
            this.unseenHrefs = [];         // 未读帖子链接列表
            this.currentTask = null;       // 当前任务（导航/滚动等）
            this.scrollTimer = null;       // 滚动定时器
        }

        // 从localStorage加载状态
        loadFromStorage() {
            // 解析存储的状态对象，默认空对象
            let state = {};
            try {
                state = JSON.parse(localStorage.getItem('autoReadState')) || {};
            } catch (error) {
                console.error('[AutoRead] 本地状态解析失败，已自动重置：', error);
                localStorage.removeItem('autoReadState');
            }
            // 合并默认状态与存储状态
            Object.assign(this, {
                isReading: !!state.isReading,        // 布尔值转换
                isLiking: state.isLiking ?? false,    // 安全默认值
                errorRetries: state.errorRetries || 0,
                unseenHrefs: state.unseenHrefs || []
            });
            this.resetLikeCounter();  // 重置每日点赞计数
        }

        // 保存状态到localStorage
        saveToStorage() {
            // 仅持久化可序列化且必要的字段，避免DOM对象导致序列化异常
            localStorage.setItem('autoReadState', JSON.stringify({
                isReading: this.isReading,
                isLiking: this.isLiking,
                errorRetries: this.errorRetries,
                unseenHrefs: this.unseenHrefs
            }));
        }

        // 每日点赞计数重置（超过24小时）
        resetLikeCounter() {
            const lastUpdate = localStorage.getItem('likeTimestamp');
            if (lastUpdate && Date.now() - +lastUpdate > 86400000) { // 86400000ms = 24小时
                localStorage.setItem('likeCount', 0);       // 重置计数
                localStorage.setItem('likeTimestamp', Date.now()); // 更新时间戳
            }
        }
    }

    /**
     * 自动阅读核心类
     * 负责业务逻辑处理和用户交互
     */
    class AutoReader {
        constructor() {
            this.state = new StateManager();  // 初始化状态管理器
            this.pageReadyRetries = 0;        // 当前页面就绪重试计数（运行时状态）
            this.isInitialized = false;       // 防止重复初始化
            this.init();                      // 初始化脚本
        }

        // 统一日志输出（便于排查流程问题）
        log(message, data) {
            if (!CONFIG.ENABLE_LOG) return;
            const time = new Date().toLocaleTimeString();
            if (data !== undefined) {
                console.log(`[AutoRead ${time}] ${message}`, data);
            } else {
                console.log(`[AutoRead ${time}] ${message}`);
            }
        }

        // 初始化入口
        init() {
            const bootstrap = () => {
                if (this.isInitialized) return;
                this.isInitialized = true;
                this.log('执行初始化', { readyState: document.readyState });
                this.createControlPanel();   // 创建控制面板
                this.handleRoute();          // 处理当前路由
                setInterval(() => this.updateStatus(), CONFIG.UPDATE_INTERVAL); // 定期更新状态
            };

            // 页面已可用时立即初始化，避免错过load事件导致不执行
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                bootstrap();
            } else {
                document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
                window.addEventListener('load', bootstrap, { once: true });
            }

            // bfcache 场景下返回页面会触发 pageshow，这里补一次路由处理
            window.addEventListener('pageshow', () => {
                this.log('pageshow 触发，重新处理路由');
                this.handleRoute();
            });
        }

        /**
         * 路由处理
         * 根据当前页面路径执行不同逻辑
         */
        handleRoute() {
            if (!this.state.isReading) return; // 未开启阅读时不自动执行

            this.log('路由处理开始', {
                pathname: window.location.pathname,
                remaining: this.state.unseenHrefs.length,
                isReading: this.state.isReading
            });

            if (window.location.pathname === '/unseen') { // 未读页面
                this.fetchUnseenLinks();  // 获取未读链接
            } else { // 阅读中状态
                this.processCurrentPage();  // 处理当前页面内容
            }
        }

        /**
         * 获取未读帖子链接
         */
        fetchUnseenLinks() {
            // 使用CSS选择器获取所有未读帖子链接
            const links = Array.from(document.querySelectorAll('a.title.raw-link.raw-topic-link'))
                .map(link => link.getAttribute('href'));  // 提取链接
            this.log('抓取未读链接完成', { count: links.length });

            if (links.length) { // 存在未读链接
                this.state.unseenHrefs = links;            // 更新状态
                this.state.saveToStorage();                // 保存到本地
                this.openNextTopic();                     // 打开下一个帖子
            } else { // 无未读内容
                alert('未发现未读内容');
            }
        }

        /**
         * 打开下一个帖子
         */
        openNextTopic() {
            const nextUrl = this.state.unseenHrefs.shift(); // 取出队列中第一个链接
            if (nextUrl) { // 存在有效链接
                const targetUrl = new URL(nextUrl, CONFIG.BASE_URL).href; // 兼容相对/绝对链接
                this.log('打开下一个帖子', {
                    nextUrl,
                    targetUrl,
                    remaining: this.state.unseenHrefs.length
                });
                this.state.currentTask = 'navigating';      // 设置任务状态为导航
                this.state.saveToStorage();                // 保存状态
                window.location.href = targetUrl; // 跳转页面
            } else { // 链接队列已空
                this.log('未读链接为空，返回 /unseen');
                this.navigateToUnseen();                    // 回到未读页面重新获取
            }
        }

        /**
         * 处理当前页面内容（阅读逻辑）
         */
        processCurrentPage() {
            if (this.isErrorPage()) return this.handleError(); // 先检查错误页面

            // 判断是不是帖子详情页，如果不是，打开第一个未读链接
            if (!document.querySelector('article[data-post-id]')) {
                this.pageReadyRetries++;
                if (this.pageReadyRetries <= CONFIG.PAGE_READY_RETRIES) {
                    this.log('帖子内容未就绪，延迟重试', {
                        retry: this.pageReadyRetries,
                        max: CONFIG.PAGE_READY_RETRIES
                    });
                    setTimeout(() => this.processCurrentPage(), CONFIG.PAGE_READY_INTERVAL);
                    return;
                }
                this.log('页面重试超限，尝试打开下一个帖子');
                this.pageReadyRetries = 0;
                this.openNextTopic();
                return;
            }
            this.pageReadyRetries = 0;
            // 判断是否存在返回上次阅读的按钮
            const backButton = document.querySelector('[title="返回上一个未读帖子"]');
            if (backButton && CONFIG.AUTO_CLICK_BACK_BUTTON) {
                this.log('检测到返回未读按钮，执行点击');
                backButton.click(); // 点击按钮返回
            }

            // 获取当前页面所有帖子
            const posts = Array.from(document.querySelectorAll('article[data-post-id]'));
            this.log('开始处理帖子页面', { postCount: posts.length });
            this.state.currentTask = 'scrolling';             // 设置任务状态为滚动
            this.startSmoothScroll();                         // 启动平滑滚动
            if (this.state.isLiking) this.runAutoLike();       // 启用点赞则执行点赞逻辑
        }

        /**
         * 启动平滑滚动
         */
        startSmoothScroll() {
            if (this.state.scrollTimer) return; // 避免重复启动
            this.log('启动平滑滚动');

            // 记录上一次滚动时间
            let lastScrollTime = 0;
            let noMoveFrames = 0; // 连续未移动帧数，用于兜底判定到底
            // 滚动速度（像素/帧）
            const scrollSpeed = CONFIG.SCROLL_OPTIONS.speed;
            const scrollElement = document.scrollingElement || document.documentElement;

            // 使用requestAnimationFrame实现平滑滚动
            const scrollStep = () => {
                if (!this.state.isReading) {
                    this.stopScrolling();
                    return;
                }
                let timestamp = performance.now(); // 获取当前时间戳

                // 控制滚动频率，防止过快
                if (timestamp - lastScrollTime < CONFIG.SCROLL_OPTIONS.interval) {
                    this.state.scrollTimer = requestAnimationFrame(scrollStep);
                    return;
                }
                lastScrollTime = timestamp; // 更新上一次滚动时间

                const beforeTop = scrollElement.scrollTop;
                scrollElement.scrollTop = beforeTop + scrollSpeed; // 执行滚动
                window.scrollBy(0, scrollSpeed); // 兜底滚动（兼容部分页面滚动容器差异）
                const afterTop = scrollElement.scrollTop;
                noMoveFrames = afterTop === beforeTop ? noMoveFrames + 1 : 0;

                // 判断是否阅读完毕
                const divReplies = document.querySelector('div.timeline-replies'); // 查找底部元素
                let isRepliesDone = false;
                let progressText = '';
                if (divReplies?.textContent) {
                    progressText = divReplies.textContent.trim();
                    const match = progressText.match(/(\d+)\s*\/\s*(\d+)/);
                    if (match) {
                        const current = Number(match[1]);
                        const total = Number(match[2]);
                        isRepliesDone = total > 0 && current >= total;
                    }
                }

                const nearBottom = afterTop + window.innerHeight >= scrollElement.scrollHeight - 8;
                const isBottomFallback = nearBottom && noMoveFrames >= 5;
                if (isRepliesDone || isBottomFallback) {
                    this.log('检测到阅读到底，切换下一帖子', {
                        progress: progressText || '未知',
                        nearBottom,
                        noMoveFrames
                    });
                    this.stopScrolling();       // 停止滚动
                    this.openNextTopic();       // 打开下一个帖子
                    return;
                }

                this.markReadPosts();           // 标记已读帖子
                this.state.scrollTimer = requestAnimationFrame(scrollStep); // 继续下一帧
            };

            // 开始滚动动画
            this.state.scrollTimer = requestAnimationFrame(scrollStep);
        }

        /**
         * 停止滚动
         */
        stopScrolling() {
            if (this.state.scrollTimer) {
                cancelAnimationFrame(this.state.scrollTimer); // 取消动画帧
                this.state.scrollTimer = null;         // 重置定时器引用
                this.log('停止滚动');
            }
            this.state.currentTask = null;         // 清除当前任务
        }

        /**
         * 标记可见帖子为已读
         */
        markReadPosts() {
            document.querySelectorAll('article[data-post-id]').forEach(post => {
                const rect = post.getBoundingClientRect(); // 获取元素位置信息
                // 元素完全在视口内时并且是已读状态，标记为已读，
                if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
                    post.classList.add('read-state'); // 添加已读类
                }
            });
        }

        /**
         * 自动点赞逻辑（递归调用实现随机间隔）
         */
        runAutoLike() {
            const likeCount = parseInt(localStorage.getItem('likeCount')) || 0; // 当前点赞数
            if (likeCount >= CONFIG.LIKE_LIMIT) return; // 达到上限则停止

            // 查找未点赞的按钮（优先使用明确的选择器）
            const likeButton = document.querySelector('.discourse-reactions-reaction-button:not(.liked)');
            if (likeButton) {
                likeButton.click(); // 模拟点击
                // 更新点赞计数和时间戳
                localStorage.setItem('likeCount', likeCount + 1);
                localStorage.setItem('likeTimestamp', Date.now());
                // 生成随机间隔（递归调用实现链式延迟）
                const randomDelay = Math.random() * (CONFIG.LIKE_INTERVAL.max - CONFIG.LIKE_INTERVAL.min) + CONFIG.LIKE_INTERVAL.min;
                setTimeout(() => this.runAutoLike(), randomDelay);
            }
        }

        /**
         * 检测是否为错误页面
         * @returns {boolean} 是否为404页面
         */
        isErrorPage() {
            return document.title.includes('找不到页面');
        }

        /**
         * 错误页面处理
         */
        handleError() {
            this.state.errorRetries++; // 重试次数加一
            this.log('进入错误页面处理', {
                retries: this.state.errorRetries,
                maxRetries: CONFIG.MAX_RETRIES
            });

            if (this.state.errorRetries > CONFIG.MAX_RETRIES) { // 超过最大重试次数
                this.log('错误重试超过上限，重置状态');
                this.resetState();                             // 重置所有状态
                return;
            }
            this.openNextTopic(); // 尝试打开下一个帖子
        }

        /**
         * 重置所有状态（用于错误处理或用户重置）
         */
        resetState() {
            this.state.initState(); // 恢复初始状态
            this.state.saveToStorage(); // 保存到本地
        }

        /**
         * 创建控制面板
         */
        createControlPanel() {
            const controls = document.createElement('div'); // 容器元素
            controls.className = 'fixed bottom-4 left-4 z-50 bg-white flex flex-col gap-2'; // 样式

            // 创建阅读控制按钮
            this.createControlButton(controls, 'openRead', '开始阅读', '停止阅读', () => {
                this.state.isReading = !this.state.isReading; // 切换阅读状态
                this.state.saveToStorage();                   // 保存状态
                this.state.isReading ? this.processCurrentPage() : this.stopScrolling();// 根据状态执行相应操作
                this.updateStatus();// 更新状态
                document.getElementById('openRead').textContent = this.state.isReading ? '停止阅读' : '开始阅读';// 更新按钮文本
            });

            // 创建点赞控制按钮
            this.createControlButton(controls, 'openUP', '启用点赞', '禁用点赞', () => {
                this.state.isLiking = !this.state.isLiking; // 切换点赞状态
                this.state.saveToStorage();                 // 保存状态
                this.updateStatus(); // 更新状态
                document.getElementById('openUP').textContent = this.state.isLiking ? '禁用点赞' : '启用点赞';// 更新按钮文本
            });

            // 创建重置列表按钮
            this.createControlButton(controls, 'resetList', '重置列表', '重置列表', () => {
                if (confirm('确定要重置未读列表吗？')) { // 确认提示
                    this.resetState();                     // 重置状态
                    alert('未读列表已重置');
                }
            });

            // 创建状态显示面板
            const status = document.createElement('div'); // 状态面板
            status.id = 'auto-read-status'; // 唯一ID
            // 在按钮的上面显示，并且在左侧顶上
            status.className = 'fixed top-20 left-5 z-9999 bg-white shadow-lg rounded-lg p-2 flex flex-col gap-1';
            controls.appendChild(status); // 添加到控制面板
            this.updateStatus(); // 初始化状态显示

            document.body.appendChild(controls); // 添加到页面
        }

        /**
         * 创建通用控制按钮
         * @param {HTMLElement} parent - 父容器
         * @param {string} id - 唯一ID
         * @param {string} startText - 初始文本
         * @param {string} stopText - 激活后文本
         * @param {Function} onClick - 点击事件处理函数
         */
        createControlButton(parent, id, startText, stopText, onClick) {
            const button = document.createElement('button'); // 创建按钮元素
            // 基础样式
            button.id = id;
            button.className = 'px-4 py-2 rounded-lg shadow-lg hover:scale-105 transition-all duration-300 bg-white text-black font-bold';
            // 初始文本（根据当前状态判断）
            button.textContent = this.state.isReading && startText === '开始阅读' ? stopText : startText;
            button.addEventListener('click', onClick); // 绑定点击事件
            parent.appendChild(button); // 添加到父容器
        }

        /**
         * 更新状态显示面板
         */
        updateStatus() {
            const status = document.getElementById('auto-read-status');
            if (!status) return; // 面板不存在时返回

            const likeCount = parseInt(localStorage.getItem('likeCount')) || 0; // 获取点赞计数
            // 使用模板字符串更新面板内容
            status.innerHTML = `
                <div class="font-bold text-sm">
                    阅读状态：${this.state.isReading ? '<span class="text-green-600">运行中</span>' : '<span class="text-red-600">已停止</span>'}<br />
                    点赞状态：${this.state.isLiking ? '<span class="text-green-600">启用</span>' : '<span class="text-red-600">禁用</span>'}<br />
                    今日点赞：${likeCount}/${CONFIG.LIKE_LIMIT}<br />
                    剩余帖子：${this.state.unseenHrefs.length}<br />
                    错误重试：<span class="text-red-600">${this.state.errorRetries}/${CONFIG.MAX_RETRIES}</span>
                </div>
            `;
        }

        /**
         * 导航到未读页面
         */
        navigateToUnseen() {
            window.location.href = `${CONFIG.BASE_URL}/unseen`; // 跳转URL
        }
    }

    // 初始化脚本入口
    new AutoReader();
})();
