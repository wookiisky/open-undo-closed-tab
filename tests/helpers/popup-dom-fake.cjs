// 只模拟弹窗依赖的 DOM 节点，不解释 HTML。
class FakeNode {
    // 节点保留原始文本及子节点，供测试检查真实文字边界。
    constructor(tagName = '') {
        this.tagName = tagName;
        this.children = [];
        this.style = { setProperty() {} };
        this.className = '';
        this.classList = { add() {}, toggle() {} };
        this.value = '';
        this.clientHeight = 240;
        this.scrollTop = 0;
        this.listeners = new Map();
        this.text = '';
    }

    // 写入文本时替换旧子节点。
    set textContent(value) { this.text = String(value); this.children = []; }
    // 读取节点及所有子节点的文本。
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    // 旧代码只允许清空容器；任何 HTML 构造都必须被测试发现。
    set innerHTML(value) {
        if (value !== '') throw new Error('测试 DOM 不允许通过 HTML 构造文字');
        this.text = '';
        this.children = [];
    }
    // 模拟文本节点的 HTML 转义，供旧实现的失败测试定位问题。
    get innerHTML() { return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
    // 插入 fragment 时移动它的子节点。
    appendChild(child) {
        if (child.tagName === '#fragment') this.children.push(...child.children);
        else this.children.push(child);
        return child;
    }
    // 替换可见节点。
    replaceChildren(...children) { this.text = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
    // 保存事件监听器。
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    // 记录属性。
    setAttribute(name, value) { this[name] = value; }
}

// 提供可手动推进帧的 DOM，避免测试依赖真实时间。
function createPopupDom() {
    const nodes = new Map();
    const frames = new Map();
    const timers = new Map();
    let nextId = 0;
    let initialize;
    const document = {
        body: new FakeNode('body'),
        documentElement: new FakeNode('html'),
        addEventListener(name, listener) { initialize = listener; },
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, new FakeNode('div'));
            return nodes.get(id);
        },
        createElement: tag => new FakeNode(tag),
        createTextNode: text => { const node = new FakeNode('#text'); node.textContent = text; return node; },
        createDocumentFragment: () => new FakeNode('#fragment')
    };
    return {
        document, nodes, frames,
        initialize: () => initialize(),
        requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        flushFrame() {
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach(callback => callback());
        }
    };
}

module.exports = { createPopupDom };
