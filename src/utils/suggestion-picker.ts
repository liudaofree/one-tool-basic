export function createSuggestionPicker() {
  const menu = document.createElement('div');
  menu.className = 'suggestion-picker-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.appendChild(menu);

  let input: HTMLInputElement | null = null;
  let options: string[] = [];
  let visible: string[] = [];
  let active = -1;

  function close() {
    menu.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
    input = null;
    active = -1;
  }

  function choose(value: string) {
    const target = input;
    if (!target) return;
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    target.focus();
  }

  function highlight(index: number) {
    active = index;
    menu.querySelectorAll<HTMLButtonElement>('[role="option"]').forEach((option, i) => {
      option.classList.toggle('active', i === index);
      option.setAttribute('aria-selected', String(i === index));
    });
  }

  function open(target: HTMLInputElement, values: string[], showAll = false) {
    input = target;
    options = values;
    const query = target.value.trim().toLocaleLowerCase();
    visible = showAll ? options : options.filter(value => value.toLocaleLowerCase().includes(query));
    menu.replaceChildren();
    visible.forEach(value => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'suggestion-picker-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = value;
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => choose(value));
      menu.appendChild(option);
    });
    active = -1;
    menu.hidden = visible.length === 0;
    target.setAttribute('aria-expanded', String(!menu.hidden));
    if (menu.hidden) return;
    const rect = target.getBoundingClientRect();
    const height = Math.min(visible.length * 34 + 8, 240);
    const above = window.innerHeight - rect.bottom < height + 8 && rect.top > height + 8;
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${above ? rect.top - height - 4 : rect.bottom + 4}px`;
    menu.style.width = `${Math.max(rect.width, 240)}px`;
  }

  document.addEventListener('pointerdown', event => {
    if (input && event.target !== input && !menu.contains(event.target as Node)) close();
  });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', event => { if (event.target !== menu) close(); }, true);

  return {
    attach(target: HTMLInputElement, values: string[]) {
      target.addEventListener('focus', () => open(target, values));
      target.addEventListener('input', () => open(target, values));
      target.addEventListener('keydown', event => {
        if (event.key === 'Escape') { close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (menu.hidden || input !== target) open(target, values, true);
          if (visible.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length);
        } else if (event.key === 'Enter' && input === target && !menu.hidden && active >= 0) {
          event.preventDefault();
          choose(visible[active]);
        }
      });
    },
    close,
  };
}
