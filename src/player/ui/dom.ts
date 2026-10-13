/**
 * Minimal element builder for the UI kit. Text always goes through textContent; there is no way
 * to pass markup, and no inline style: look comes from classes, dynamic values from CSS variables.
 */
export type Child = Node | string | number | false | null | undefined;
type Listeners = { [E in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[E]) => void };
export interface Props {
  class?: string | undefined;
  id?: string | undefined;
  text?: string | undefined;
  testid?: string | undefined;
  attrs?: Record<string, string | number | boolean | undefined> | undefined;
  vars?: Record<string, string | number> | undefined;
  on?: Listeners | undefined;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.testid) node.dataset.testid = props.testid;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, value] of Object.entries(props.vars ?? {})) node.style.setProperty(name, String(value));
  for (const [name, listener] of Object.entries(props.on ?? {})) node.addEventListener(name, listener as EventListener);
  append(node, children);
  return node;
}

export function append(parent: Element | DocumentFragment, children: Child[]): void {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    parent.append(typeof child === 'number' ? String(child) : child);
  }
}

export function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
