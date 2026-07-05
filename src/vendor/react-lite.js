let hookCursor = 0;
let hooks = [];
let pendingEffects = [];
let rerender = () => {};

export function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity) };
}

export function useState(initialValue) {
  const cursor = hookCursor;
  hooks[cursor] ??= typeof initialValue === 'function' ? initialValue() : initialValue;
  function setState(nextValue) {
    hooks[cursor] = typeof nextValue === 'function' ? nextValue(hooks[cursor]) : nextValue;
    rerender();
  }
  hookCursor += 1;
  return [hooks[cursor], setState];
}

export function useMemo(factory, deps) {
  const cursor = hookCursor;
  const previous = hooks[cursor];
  if (!previous || depsChanged(previous.deps, deps)) {
    hooks[cursor] = { value: factory(), deps };
  }
  hookCursor += 1;
  return hooks[cursor].value;
}

export function useEffect(effect, deps) {
  const cursor = hookCursor;
  const previous = hooks[cursor];
  if (!previous || depsChanged(previous.deps, deps)) {
    pendingEffects.push(effect);
    hooks[cursor] = { deps };
  }
  hookCursor += 1;
}

export function __render(vnode, container) {
  rerender = () => __render(vnode, container);
  hookCursor = 0;
  pendingEffects = [];
  container.replaceChildren(toDom(vnode));
  for (const effect of pendingEffects) effect();
}

function depsChanged(previous = [], next = []) {
  return previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

function toDom(vnode) {
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return document.createTextNode('');
  if (Array.isArray(vnode)) {
    const fragment = document.createDocumentFragment();
    vnode.forEach((child) => fragment.appendChild(toDom(child)));
    return fragment;
  }
  if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode));
  if (typeof vnode.type === 'function') return toDom(vnode.type({ ...vnode.props, children: vnode.children }));

  const element = document.createElement(vnode.type);
  applyProps(element, vnode.props);
  vnode.children.forEach((child) => element.appendChild(toDom(child)));
  return element;
}

function applyProps(element, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || value === null || value === undefined || value === false) continue;
    if (key === 'className') {
      element.setAttribute('class', value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') {
      element.value = value;
    } else if (key === 'disabled') {
      if (value) element.setAttribute('disabled', '');
    } else {
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

export default { createElement };
