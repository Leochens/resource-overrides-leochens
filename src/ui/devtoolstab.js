(function() {
    "use strict";

    /* globals chrome */

    const app = window.app;
    const ui = app.ui;
    const util = app.util;

    app.mainSuggest = app.suggest();
    app.requestHeadersSuggest = app.suggest();
    app.responseHeadersSuggest = app.suggest();
    app.files = {};
    app.skipNextSync = false;

    // 标记是否有未保存的排序更改
    let hasUnsavedChanges = false;

    // 添加全局开关状态
    let globalEnabled = true;

    // 添加move函数到app对象
    app.move = function(type, id) {
        chrome.runtime.sendMessage({
            action: "getDomains",
        }, (domains) => {
            domains = domains.map((d, idx) => ({
                ...d,
                idx
            }))
            if (type === 'up') {
                if (id == 0) {
                    return app.util.showToast("已经是第一个了，不能上移！")
                }
                let index = id;
                let pre = index - 1;
                const preDomain = domains[pre]
                const curDomain = domains[index];
                domains.splice(index, 1, preDomain);
                domains.splice(pre, 1, curDomain);
            } else if (type === 'down') {
                if (id == (domains.length - 1)) {
                    return app.util.showToast("已经是最后一个了，不能下移！")
                }
                let index = id;
                let after = index + 1;
                const afterDomain = domains[after]
                const curDomain = domains[index];
                domains.splice(index, 1, afterDomain);
                domains.splice(after, 1, curDomain);
            } else {
                return;
            }
            domains.forEach((d) => {
                delete d.idx;
            })
            chrome.runtime.sendMessage({
                action: "clear",
            }, () => {
                chrome.runtime.sendMessage({
                    action: "import",
                    data: domains
                })
            })
        })
    };

    function renderData() {
        app.files = {};
        ui.domainDefs.children().remove();
        chrome.runtime.sendMessage({action: "getDomains"}, function(domains) {
            if (domains.length) {
                domains.forEach(function(domain, idx) {
                    domain.idx = idx;
                    const domainMarkup = app.createDomainMarkup(domain);
                    ui.domainDefs.append(domainMarkup);
                });
            } else {
                const newDomain = app.createDomainMarkup({rules: [{type: "normalOverride"}]});
                ui.domainDefs.append(newDomain);
                newDomain.find(".domainMatchInput").val("*");
                chrome.runtime.sendMessage({
                    action: "saveDomain",
                    data: app.getDomainData(newDomain)
                });
                app.skipNextSync = true;
            }
            util.getTabResources(function(res) {
                app.mainSuggest.fillOptions(res);
            });
        });
    }

    function setupSynchronizeConnection() {
        chrome.runtime.sendMessage({action: "syncMe"}, function() {
            // 只有在没有未保存的更改时才进行同步刷新
            if (!app.skipNextSync && !hasUnsavedChanges) {
                renderData();
            }
            app.skipNextSync = false;
            setupSynchronizeConnection();
        });
    }

    // 本地移动函数，只改变DOM位置
    function moveLocal(type, domainContainer) {
        const container = ui.domainDefs[0];
        const domains = [...container.querySelectorAll('.domainContainer')];
        const currentIndex = domains.indexOf(domainContainer[0]);

        if (type === 'up') {
            if (currentIndex === 0) {
                return util.showToast("已经是第一个了，不能上移！");
            }
            // 使用 jQuery 的 insertBefore 方法，避免重绘
            domainContainer.insertBefore($(domains[currentIndex - 1]));
        } else if (type === 'down') {
            if (currentIndex === domains.length - 1) {
                return util.showToast("已经是最后一个了，不能下移！");
            }
            // 使用 jQuery 的 insertAfter 方法，避免重绘
            domainContainer.insertAfter($(domains[currentIndex + 1]));
        }

        // 标记有未保存的更改
        hasUnsavedChanges = true;
        $('#saveSortBtn').css('background-color', '#ff9800').text('保存排序*');
    }

    // 保存当前排序到后台
    function saveCurrentSort() {
        const domains = [...ui.domainDefs[0].querySelectorAll('.domainContainer')].map(domain => {
            return app.getDomainData($(domain));
        });

        // 设置标志防止保存时触发重绘
        app.skipNextSync = true;
        
        chrome.runtime.sendMessage({
            action: "clear",
        }, () => {
            chrome.runtime.sendMessage({
                action: "import",
                data: domains
            }, () => {
                hasUnsavedChanges = false;
                $('#saveSortBtn').css('background-color', '#4CAF50').text('保存当前排序');
                util.showToast("排序已保存！");
            });
        });
    }

    function init() {
        app.mainSuggest.init();
        app.requestHeadersSuggest.init();
        app.responseHeadersSuggest.init();
        app.requestHeadersSuggest.fillOptions(app.headersLists.requestHeaders);
        app.responseHeadersSuggest.fillOptions(app.headersLists.responseHeaders);

        setupSynchronizeConnection();

        // 初始渲染
        renderData();

        // 添加保存排序按钮的点击处理
        $('#saveSortBtn').on('click', function() {
            if (!hasUnsavedChanges) {
                return util.showToast("没有需要保存的更改！");
            }
            saveCurrentSort();
        });

        // 处理分组的上移和下移
        ui.domainDefs.on('click', '#groupMoveUp, #groupMoveDown', function(e) {
            const btn = $(this);
            const domainContainer = btn.closest('.domainContainer');
            const isUp = btn.attr('id') === 'groupMoveUp';
            
            // 直接调用本地移动函数
            moveLocal(isUp ? 'up' : 'down', domainContainer);
        });

        // 添加离开页面前的提示
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '有未保存的排序更改，确定要离开吗？';
                return e.returnValue;
            }
        });

        // 添加清空所有按钮的点击处理
        $('#clearAllBtn').on('click', function() {
            if (!confirm('确定要清空所有规则吗？此操作不可恢复！')) {
                return;
            }
            chrome.runtime.sendMessage({
                action: "clear",
            }, () => {
                // 清空后重新渲染
                renderData();
                util.showToast("已清空所有规则！");
            });
        });

        ui.addDomainBtn.on("click", function() {
            const newDomain = app.createDomainMarkup();
            newDomain.find(".domainMatchInput").val("*");
            ui.domainDefs.append(newDomain);
            chrome.runtime.sendMessage({action: "saveDomain", data: app.getDomainData(newDomain)});
            app.skipNextSync = true;
        });

        ui.helpBtn.on("click", function() {
            ui.helpOverlay.toggle();
        });

        ui.helpCloseBtn.on("click", function() {
            ui.helpOverlay.hide();
        });

        if (!chrome.devtools) {
            ui.showSuggestions.hide();
            ui.showSuggestionsText.hide();
            chrome.runtime.sendMessage({
                action: "getSetting",
                setting: "tabPageNotice"
            }, function(data) {

                if (data !== "true") {
                    ui.tabPageNotice.find("a").on("click", function(e) {
                        e.preventDefault();
                        chrome.runtime.sendMessage({
                            action: "setSetting",
                            setting: "tabPageNotice",
                            value: "true"
                        });
                        ui.tabPageNotice.fadeOut();
                    });
                    ui.tabPageNotice.fadeIn();
                    setTimeout(function() {
                        ui.tabPageNotice.fadeOut();
                    }, 6000);
                }
            });
        }

        if (navigator.userAgent.indexOf("Firefox") > -1 && !!chrome.devtools) {
            // Firefox is really broken with the "/" and "'" keys. They just dont work.
            // So try to fix them here.. wow.. just wow. I can't believe I'm fixing the ability to type.
            const brokenKeys = { "/": 1, "?": 1, "'": 1, '"': 1 };
            window.addEventListener("keydown", e => {
                const brokenKey = brokenKeys[e.key];
                const activeEl = document.activeElement;
                if (brokenKey && (activeEl.nodeName === "INPUT" || activeEl.nodeName === "TEXTAREA") &&
                    activeEl.className !== "ace_text-input") {

                    e.preventDefault();
                    const start = activeEl.selectionStart;
                    const end = activeEl.selectionEnd;
                    activeEl.value = activeEl.value.substring(0, start) + e.key +
                        activeEl.value.substring(end, activeEl.value.length);
                    activeEl.selectionStart = start + 1;
                    activeEl.selectionEnd = start + 1;
                }
            });
        }
        util.showGlobalOff(localStorage.getItem('globalOff'), false);

        // 全局开关按钮点击事件
        $('#globalOffBtn').on('click', function() {
            globalEnabled = !globalEnabled;
            $(this).text(globalEnabled ? '全局开关' : '已禁用');
            $(this).toggleClass('disabled', !globalEnabled);
            
            // 通知后台服务更新状态
            chrome.runtime.sendMessage({
                action: 'setGlobalEnabled',
                enabled: globalEnabled
            });
        });

        // 初始化时获取全局状态
        chrome.runtime.sendMessage({ action: 'getGlobalEnabled' }, function(response) {
            globalEnabled = response.enabled;
            $('#globalOffBtn').text(globalEnabled ? '全局开关' : '已禁用')
                .toggleClass('disabled', !globalEnabled);
        });

        // 初始化拖拽排序
        initDragSort();
    }

    // 初始化拖拽排序
    function initDragSort() {
        const container = document.getElementById('domainDefs');
        let draggedItem = null;
        
        // 只允许从拖拽手柄开始拖动
        container.addEventListener('mousedown', (e) => {
            if (e.target.closest('.group-handle')) {
                const domainContainer = e.target.closest('.domainContainer');
                if (domainContainer) {
                    domainContainer.setAttribute('draggable', 'true');
                }
            }
        });

        container.addEventListener('mouseup', () => {
            const draggableItems = container.querySelectorAll('.domainContainer[draggable=true]');
            draggableItems.forEach(item => item.setAttribute('draggable', 'false'));
        });

        container.addEventListener('dragstart', (e) => {
            const domainContainer = e.target.closest('.domainContainer');
            if (!domainContainer) return;
            
            draggedItem = domainContainer;
            requestAnimationFrame(() => {
                draggedItem.classList.add('dragging');
                draggedItem.style.opacity = '0.5';
            });
        });

        container.addEventListener('dragend', (e) => {
            if (!draggedItem) return;
            
            requestAnimationFrame(() => {
                draggedItem.classList.remove('dragging');
                draggedItem.style.opacity = '';
                draggedItem.setAttribute('draggable', 'false');
                draggedItem = null;
            });

            // 获取所有分组的新顺序
            const domains = [...container.querySelectorAll('.domainContainer')].map(domain => {
                return app.getDomainData($(domain));
            });

            // 清除旧数据并导入新顺序的数据
            chrome.runtime.sendMessage({
                action: "clear",
            }, () => {
                chrome.runtime.sendMessage({
                    action: "import",
                    data: domains
                });
            });
            
            app.skipNextSync = true;
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedItem) return;

            const siblings = [...container.querySelectorAll('.domainContainer:not(.dragging)')];
            let nextSibling = null;

            const mouseY = e.clientY;
            for (const sibling of siblings) {
                const box = sibling.getBoundingClientRect();
                const boxCenter = box.top + box.height / 2;

                if (mouseY < boxCenter) {
                    nextSibling = sibling;
                    break;
                }
            }

            if (nextSibling !== draggedItem.nextElementSibling) {
                container.insertBefore(draggedItem, nextSibling);
            }
        });

        // 防止拖动时触发其他点击事件
        container.addEventListener('click', (e) => {
            if (e.target.closest('.group-handle')) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    // 更新分组顺序
    function updateDomainsOrder() {
        const domains = [...ui.domainDefs[0].querySelectorAll('.domainContainer')].map(domain => {
            return app.getDomainData($(domain));
        });

        chrome.runtime.sendMessage({
            action: "clear",
        }, () => {
            chrome.runtime.sendMessage({
                action: "import",
                data: domains
            });
        });
        
        app.skipNextSync = true;
    }

    init();

})();
