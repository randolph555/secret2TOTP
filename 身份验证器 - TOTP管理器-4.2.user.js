// ==UserScript==
// @name         身份验证器 - TOTP管理器
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  仿Android身份验证器界面的TOTP动态验证码管理器
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 等待页面加载完成
    function waitForLoad(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            setTimeout(callback, 100);
        }
    }

    // Base32解码
    function base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        let hex = '';

        encoded = encoded.replace(/[^A-Z2-7]/gi, '').toUpperCase();

        for (let i = 0; i < encoded.length; i++) {
            const val = alphabet.indexOf(encoded.charAt(i));
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }

        for (let i = 0; i + 8 <= bits.length; i += 8) {
            const chunk = bits.substr(i, 8);
            hex += parseInt(chunk, 2).toString(16).padStart(2, '0');
        }

        return hex;
    }

    // 验证Secret格式
    function validateSecret(secret) {
        if (!secret || secret.length < 16) return false;
        const cleanSecret = secret.replace(/[^A-Z2-7]/gi, '');
        const base32Regex = /^[A-Z2-7]+$/i;
        return base32Regex.test(cleanSecret) && cleanSecret.length % 8 === 0;
    }

    // TOTP生成
    function generateTOTP(secret) {
        try {
            if (!validateSecret(secret)) return 'ERROR';

            const epoch = Math.floor(Date.now() / 1000);
            const counter = Math.floor(epoch / 30);

            const key = base32Decode(secret);
            const counterHex = counter.toString(16).padStart(16, '0');

            const hmac = CryptoJS.HmacSHA1(CryptoJS.enc.Hex.parse(counterHex), CryptoJS.enc.Hex.parse(key));
            const hmacHex = hmac.toString(CryptoJS.enc.Hex);

            const offset = parseInt(hmacHex.substr(-1), 16);
            const code = parseInt(hmacHex.substr(offset * 2, 8), 16) & 0x7fffffff;

            return (code % 1000000).toString().padStart(6, '0');
        } catch (e) {
            return 'ERROR';
        }
    }

    // 存储管理
    const storage = {
        save: (data) => GM_setValue('totp_data', JSON.stringify(data)),
        load: () => {
            try {
                return JSON.parse(GM_getValue('totp_data', '[]'));
            } catch {
                return [];
            }
        },
        savePosition: (key, pos) => GM_setValue(key, JSON.stringify(pos)),
        loadPosition: (key, defaultPos) => {
            try {
                return JSON.parse(GM_getValue(key, JSON.stringify(defaultPos)));
            } catch {
                return defaultPos;
            }
        }
    };

    // 获取品牌颜色和图标
    function getBrandInfo(name) {
        const brands = {
            'google': { color: '#4285f4', icon: 'G', bgColor: '#4285f4' },
            'microsoft': { color: '#00a1f1', icon: 'M', bgColor: '#f25022' },
            'github': { color: '#333', icon: 'G', bgColor: '#333' },
            'twitter': { color: '#1da1f2', icon: 'T', bgColor: '#1da1f2' },
            'facebook': { color: '#1877f2', icon: 'F', bgColor: '#1877f2' },
            'amazon': { color: '#ff9900', icon: 'A', bgColor: '#ff9900' },
            'apple': { color: '#000', icon: 'A', bgColor: '#000' },
            'discord': { color: '#5865f2', icon: 'D', bgColor: '#5865f2' },
            'steam': { color: '#171a21', icon: 'S', bgColor: '#171a21' },
            'openai': { color: '#10a37f', icon: 'O', bgColor: '#10a37f' },
            'chatgpt': { color: '#10a37f', icon: 'C', bgColor: '#10a37f' },
            'claude': { color: '#d97706', icon: 'C', bgColor: '#d97706' },
            'aliyun': { color: '#ff6a00', icon: 'A', bgColor: '#ff6a00' },
            'jumpserver': { color: '#1ab394', icon: 'J', bgColor: '#1ab394' },
            'default': { color: '#757575', icon: '🔐', bgColor: '#757575' }
        };

        const lowerName = name.toLowerCase();
        for (const brand in brands) {
            if (lowerName.includes(brand)) {
                return brands[brand];
            }
        }
        return brands.default;
    }

    let accounts = storage.load();
    let updateTimer = null;
    let mainPanel = null;
    let triggerButton = null;
    let isMinimized = false;

    // 创建主面板
    function createMainPanel() {
        if (mainPanel) return;

        const position = storage.loadPosition('panel_position', { x: 50, y: 50 });

        mainPanel = document.createElement('div');
        mainPanel.style.cssText = `
            position: fixed;
            left: ${position.x}px;
            top: ${position.y}px;
            width: 360px;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
            z-index: 10000;
            font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            user-select: none;
            overflow: hidden;
        `;

        updateMainPanel();
        document.body.appendChild(mainPanel);
        makePanelDraggable();
        startTimer();
    }

    // 更新主面板内容
    function updateMainPanel() {
        if (!mainPanel) return;

        const contentDisplay = isMinimized ? 'none' : 'block';

        mainPanel.innerHTML = `
            <div id="panel-header" style="
                padding: 16px 20px;
                background: #1976d2;
                color: white;
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            ">
                <h3 style="margin: 0; font-size: 18px; font-weight: 500;">身份验证器</h3>
                <div style="display: flex; gap: 4px;">
                    <button id="add-btn-header" style="
                        background: none;
                        border: none;
                        color: white;
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background 0.2s;
                        font-weight: 300;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'">+</button>
                    <button id="minimize-btn" style="
                        background: none;
                        border: none;
                        color: white;
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'">${isMinimized ? '□' : '−'}</button>
                    <button id="close-btn" style="
                        background: none;
                        border: none;
                        color: white;
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 18px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'">×</button>
                </div>
            </div>

            <div id="panel-content" style="display: ${contentDisplay};">
                <div id="add-section" style="display: none; padding: 20px; background: #fafafa; border-bottom: 1px solid #e0e0e0;">
                    <input type="text" id="name-input" placeholder="账户名称 (如: Google)"
                           style="width: 100%; padding: 16px; margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 4px; background: white; color: #212121; box-sizing: border-box; font-size: 16px;">
                    <input type="text" id="secret-input" placeholder="Secret密钥"
                           style="width: 100%; padding: 16px; margin-bottom: 20px; border: 1px solid #e0e0e0; border-radius: 4px; background: white; color: #212121; box-sizing: border-box; font-size: 16px;">
                    <div style="display: flex; gap: 12px;">
                        <button id="add-btn" style="
                            flex: 1;
                            padding: 12px 24px;
                            background: #1976d2;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: 500;
                            font-size: 16px;
                            text-transform: uppercase;
                        ">添加</button>
                        <button id="cancel-btn" style="
                            flex: 1;
                            padding: 12px 24px;
                            background: transparent;
                            color: #1976d2;
                            border: 1px solid #1976d2;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: 500;
                            font-size: 16px;
                            text-transform: uppercase;
                        ">取消</button>
                    </div>
                </div>

                <div id="accounts-container" style="max-height: 480px; overflow-y: auto; background: white; padding-bottom: 20px;"></div>
            </div>
        `;

        // 绑定事件
        mainPanel.querySelector('#close-btn').addEventListener('click', closePanel);
        mainPanel.querySelector('#minimize-btn').addEventListener('click', toggleMinimize);
        mainPanel.querySelector('#add-btn-header').addEventListener('click', toggleAddSection);
        mainPanel.querySelector('#add-btn').addEventListener('click', addAccount);
        mainPanel.querySelector('#cancel-btn').addEventListener('click', hideAddSection);

        renderAccounts();
    }

    // 切换添加区域
    function toggleAddSection() {
        const addSection = mainPanel.querySelector('#add-section');
        const isVisible = addSection.style.display !== 'none';
        addSection.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            mainPanel.querySelector('#name-input').focus();
        }
    }

    // 隐藏添加区域
    function hideAddSection() {
        const addSection = mainPanel.querySelector('#add-section');
        addSection.style.display = 'none';
        mainPanel.querySelector('#name-input').value = '';
        mainPanel.querySelector('#secret-input').value = '';
    }

    // 最小化/展开
    function toggleMinimize() {
        isMinimized = !isMinimized;
        updateMainPanel();
    }

    // 使面板可拖拽
    function makePanelDraggable() {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const header = mainPanel.querySelector('#panel-header');

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = mainPanel.offsetLeft;
            startTop = mainPanel.offsetTop;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            e.preventDefault();
        });

        function onMouseMove(e) {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;

            newLeft = Math.max(0, Math.min(window.innerWidth - mainPanel.offsetWidth, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - mainPanel.offsetHeight, newTop));

            mainPanel.style.left = newLeft + 'px';
            mainPanel.style.top = newTop + 'px';
        }

        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            storage.savePosition('panel_position', {
                x: mainPanel.offsetLeft,
                y: mainPanel.offsetTop
            });
        }
    }

    // 添加账户
    function addAccount() {
        const nameInput = mainPanel.querySelector('#name-input');
        const secretInput = mainPanel.querySelector('#secret-input');
        const name = nameInput.value.trim();
        const secret = secretInput.value.trim();

        if (!name || !secret) {
            alert('请填写完整信息');
            return;
        }

        if (!validateSecret(secret)) {
            alert('Secret格式错误！请确保是有效的Base32格式密钥');
            return;
        }

        const testCode = generateTOTP(secret);
        if (testCode === 'ERROR') {
            alert('Secret密钥无效，无法生成验证码');
            return;
        }

        accounts.push({ id: Date.now(), name, secret });
        storage.save(accounts);

        hideAddSection();
        renderAccounts();
    }

    // 渲染账户列表
    function renderAccounts() {
        const container = mainPanel.querySelector('#accounts-container');
        if (!container) return;

        if (accounts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #9e9e9e;">
                    <div style="font-size: 64px; margin-bottom: 20px; opacity: 0.5;">🔐</div>
                    <div style="font-size: 18px; margin-bottom: 8px; color: #757575;">暂无账户</div>
                    <div style="font-size: 14px; color: #9e9e9e;">点击标题栏 + 号添加验证器</div>
                </div>
            `;
            return;
        }

        container.innerHTML = accounts.map(account => {
            const brandInfo = getBrandInfo(account.name);
            return `
                <div style="
                    padding: 20px;
                    border-bottom: 1px solid #f0f0f0;
                    background: white;
                    position: relative;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='white'">
                    <div style="display: flex; align-items: center;">
                        <div style="
                            width: 48px;
                            height: 48px;
                            border-radius: 50%;
                            background: ${brandInfo.bgColor};
                            color: white;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-weight: 500;
                            font-size: 20px;
                            margin-right: 16px;
                            flex-shrink: 0;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        ">${brandInfo.icon}</div>

                        <div style="flex: 1; min-width: 0; margin-right: 16px;">
                            <div style="font-size: 18px; font-weight: 500; color: #212121; margin-bottom: 8px; line-height: 1.2;">${account.name}</div>

                            <div style="
                                font-size: 32px;
                                font-weight: 400;
                                font-family: 'Roboto Mono', 'SF Mono', 'Monaco', monospace;
                                color: ${brandInfo.color};
                                letter-spacing: 6px;
                                line-height: 1;
                                white-space: nowrap;
                                overflow: hidden;
                                margin-bottom: 12px;
                            " id="code-${account.id}">000 000</div>

                            <div style="margin-top: 8px;">
                                <div id="progress-${account.id}" style="
                                    width: 100%;
                                    height: 4px;
                                    background: #e0e0e0;
                                    border-radius: 2px;
                                    overflow: hidden;
                                ">
                                    <div style="height: 100%; background: ${brandInfo.color}; width: 100%; transition: width 1s linear; border-radius: 2px;"></div>
                                </div>
                            </div>
                        </div>

                        <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                            <div id="timer-${account.id}" style="
                                font-size: 14px;
                                color: #757575;
                                font-weight: 500;
                                min-width: 24px;
                                text-align: center;
                            ">30s</div>
                            <button class="copy-btn" data-id="${account.id}" style="
                                background: none;
                                border: none;
                                color: #757575;
                                cursor: pointer;
                                padding: 6px;
                                border-radius: 50%;
                                font-size: 14px;
                                width: 28px;
                                height: 28px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                transition: background 0.2s;
                            " title="复制验证码" onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='none'">📋</button>
                        </div>

                        <button class="delete-btn" data-id="${account.id}" style="
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            background: none;
                            border: none;
                            color: #bdbdbd;
                            cursor: pointer;
                            padding: 4px;
                            border-radius: 50%;
                            font-size: 12px;
                            width: 20px;
                            height: 20px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                            opacity: 0.6;
                        " title="删除账户" onmouseover="this.style.background='#ffebee'; this.style.color='#d32f2f'; this.style.opacity='1'" onmouseout="this.style.background='none'; this.style.color='#bdbdbd'; this.style.opacity='0.6'">×</button>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定事件
        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                if (confirm('确定要删除这个账户吗？')) {
                    accounts = accounts.filter(acc => acc.id !== id);
                    storage.save(accounts);
                    renderAccounts();
                }
            });
        });

        container.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const codeElement = document.getElementById(`code-${id}`);
                const code = codeElement.textContent.replace(/\s/g, '');

                if (code && code !== '000000' && code !== 'ERROR') {
                    navigator.clipboard.writeText(code).then(() => {
                        btn.textContent = '✓';
                        btn.style.color = '#4caf50';
                        setTimeout(() => {
                            btn.textContent = '📋';
                            btn.style.color = '#757575';
                        }, 1500);
                    });
                }
            });
        });
    }

    // 更新所有验证码
    function updateCodes() {
        const now = Math.floor(Date.now() / 1000);
        const remaining = 30 - (now % 30);

        accounts.forEach(account => {
            const code = generateTOTP(account.secret);
            const codeElement = document.getElementById(`code-${account.id}`);
            const timerElement = document.getElementById(`timer-${account.id}`);
            const progressElement = document.getElementById(`progress-${account.id}`);

            if (codeElement && code !== 'ERROR') {
                const formattedCode = code.slice(0, 3) + ' ' + code.slice(3);
                codeElement.textContent = formattedCode;
            }

            if (timerElement) {
                timerElement.textContent = `${remaining}s`;
                // 时间快到时变红
                if (remaining <= 5) {
                    timerElement.style.color = '#f44336';
                } else {
                    timerElement.style.color = '#757575';
                }
            }

            if (progressElement) {
                const progress = (remaining / 30) * 100;
                const progressBar = progressElement.querySelector('div');
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                    // 时间快到时进度条变红
                    if (remaining <= 5) {
                        progressBar.style.background = '#f44336';
                    } else {
                        const brandInfo = getBrandInfo(account.name);
                        progressBar.style.background = brandInfo.color;
                    }
                }
            }
        });
    }

    // 开始定时器
    function startTimer() {
        updateCodes();
        if (updateTimer) clearInterval(updateTimer);
        updateTimer = setInterval(updateCodes, 1000);
    }

    // 关闭面板
    function closePanel() {
        if (mainPanel) {
            mainPanel.remove();
            mainPanel = null;
        }
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    }

    // 创建可拖拽的触发按钮
    function createTriggerButton() {
        const buttonPos = storage.loadPosition('button_position', { x: window.innerWidth - 70, y: 100 });

        triggerButton = document.createElement('div');
        triggerButton.innerHTML = '🔐';
        triggerButton.title = '身份验证器 (可拖拽)';
        triggerButton.style.cssText = `
            position: fixed;
            left: ${buttonPos.x}px;
            top: ${buttonPos.y}px;
            width: 56px;
            height: 56px;
            background: #1976d2;
            color: white;
            border-radius: 50%;
            cursor: pointer;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 4px 12px rgba(25,118,210,0.3);
            transition: all 0.3s ease;
            user-select: none;
            opacity: 0.9;
        `;

        // 使按钮可拖拽
        makeButtonDraggable();

        // 悬停效果
        triggerButton.addEventListener('mouseenter', () => {
            triggerButton.style.opacity = '1';
            triggerButton.style.transform = 'scale(1.1)';
            triggerButton.style.boxShadow = '0 6px 16px rgba(25,118,210,0.4)';
        });

        triggerButton.addEventListener('mouseleave', () => {
            triggerButton.style.transform = 'scale(1)';
            triggerButton.style.boxShadow = '0 4px 12px rgba(25,118,210,0.3)';
            triggerButton.style.opacity = '0.9';
        });

        document.body.appendChild(triggerButton);
    }

    // 使触发按钮可拖拽
    function makeButtonDraggable() {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        triggerButton.addEventListener('mousedown', (e) => {
            const startTime = Date.now();

            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = triggerButton.offsetLeft;
            startTop = triggerButton.offsetTop;

            const onMouseMove = (e) => {
                const deltaX = Math.abs(e.clientX - startX);
                const deltaY = Math.abs(e.clientY - startY);

                if (!isDragging && (deltaX > 5 || deltaY > 5)) {
                    isDragging = true;
                    triggerButton.style.transition = 'none';
                }

                if (isDragging) {
                    let newLeft = startLeft + (e.clientX - startX);
                    let newTop = startTop + (e.clientY - startY);

                    // 边界检查
                    newLeft = Math.max(-28, Math.min(window.innerWidth - 28, newLeft));
                    newTop = Math.max(0, Math.min(window.innerHeight - 56, newTop));

                    triggerButton.style.left = newLeft + 'px';
                    triggerButton.style.top = newTop + 'px';
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                if (isDragging) {
                    storage.savePosition('button_position', {
                        x: triggerButton.offsetLeft,
                        y: triggerButton.offsetTop
                    });
                    triggerButton.style.transition = 'all 0.3s ease';
                } else {
                    const clickTime = Date.now() - startTime;
                    if (clickTime < 200) {
                        togglePanel();
                    }
                }

                isDragging = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            e.preventDefault();
        });
    }

    // 切换面板显示
    function togglePanel() {
        if (mainPanel) {
            closePanel();
        } else {
            createMainPanel();
        }
    }

    // 初始化
    waitForLoad(() => {
        try {
            createTriggerButton();
        } catch (e) {
            console.error('身份验证器初始化失败:', e);
        }
    });

})();
