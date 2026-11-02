// Tiny hand-rolled host mocks: just enough DOM, classic `app` and Preact `PS` for the host layer.

export function mockEl(tag = 'div', doc = null) {
	const el = {
		tagName: tag.toUpperCase(),
		id: '',
		className: '',
		textContent: '',
		title: '',
		children: [],
		parent: null,
		ownerDocument: doc,
		listeners: {},
		appendChild(child) {
			child.parent = el;
			el.children.push(child);
			return child;
		},
		replaceChildren(...kids) {
			el.children = [];
			kids.forEach(k => el.appendChild(k));
		},
		remove() {
			if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el);
			el.parent = null;
		},
		addEventListener(type, fn) {
			(el.listeners[type] = el.listeners[type] || []).push(fn);
		},
		find(pred) {
			for (const c of el.children) {
				if (pred(c)) return c;
				const hit = c.find(pred);
				if (hit) return hit;
			}
			return null;
		},
		querySelector(sel) {
			const id = sel.replace(/^#/, '');
			return el.find(c => c.id === id);
		},
	};
	return el;
}

export function mockDoc({ withBody = true } = {}) {
	const doc = {
		body: null,
		documentElement: null,
		head: null,
		listeners: {},
		createElement: tag => mockEl(tag, doc),
		getElementById(id) {
			const html = doc.documentElement;
			if (html && html.id === id) return html;
			return html ? html.find(c => c.id === id) : null;
		},
		addEventListener(type, fn) {
			(doc.listeners[type] = doc.listeners[type] || []).push(fn);
		},
		makeBody() {
			doc.body = mockEl('body', doc);
			doc.documentElement.appendChild(doc.body);
		},
	};
	doc.documentElement = mockEl('html', doc);
	doc.head = mockEl('head', doc);
	doc.documentElement.appendChild(doc.head);
	if (withBody) doc.makeBody();
	return doc;
}

function spy(impl) {
	const fn = function (...args) {
		fn.calls.push({ self: this, args });
		return impl ? impl.apply(this, args) : undefined;
	};
	fn.calls = [];
	return fn;
}
export { spy };

export function mockClassicApp({ name = 'Alice', named = true } = {}) {
	const app = {
		rooms: {},
		roomList: [],
		sideRoomList: [],
		user: { get: key => ({ name, named, avatar: '12' })[key] },
		receive: spy(function () { return 'rx'; }),
		send: spy(function () { return 'tx'; }),
		focusRoomRight: spy(),
		topbar: {
			updateTabbar: spy(),
			renderRoomTab: spy((room, id) => `<i class="fa fa-file-text-o"></i>${id}`),
		},
	};
	app._addRoom = spy(function (id, type, nojoin, title) {
		const el = mockEl('div');
		const room = { id, type, nojoin, title, el, $el: { html: spy() }, destroy: spy(() => 'destroyed') };
		app.rooms[id] = room;
		app.roomList.push(room);
		return room;
	});
	return app;
}

export function mockPS({ name = 'Alice', named = true } = {}) {
	class PSRoom {
		constructor(options) {
			this.options = options;
		}
		destroy() {
			return 'super-destroyed';
		}
	}
	class PSRoomPanel {
		constructor(props) {
			this.props = props;
		}
	}
	const PS = {
		rooms: {},
		user: { name, named, avatar: '7' },
		teams: { list: [] },
		receive: spy(function () { return 'rx'; }),
		send: spy(function () { return 'tx'; }),
		roomTypes: [],
		addRoomType: spy(function (panel) { PS.roomTypes.push(panel); }),
		join: spy(),
		update: spy(),
	};
	const preact = { h: (type, props, ...children) => ({ type, props, children }) };
	return { PS, PSRoom, PSRoomPanel, PSPanelWrapper: function PSPanelWrapper() {}, preact };
}

/** window-like object for the Preact client. */
export function mockPreactWin(opts = {}) {
	const parts = mockPS(opts);
	const doc = mockDoc();
	return {
		...parts,
		document: doc,
		location: { pathname: '/' },
		history: { state: null, replaceState: spy() },
	};
}

export function mockClassicWin(opts = {}) {
	const doc = mockDoc();
	return {
		app: mockClassicApp(opts),
		document: doc,
		location: { pathname: '/' },
		history: { state: null, replaceState: spy() },
	};
}
