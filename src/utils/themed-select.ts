export function installThemedSelects(root: ParentNode = document) {
  const menu = document.createElement('div');
  menu.className = 'themed-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.appendChild(menu);
  let current: { select: HTMLSelectElement; button: HTMLButtonElement } | null = null;
  let active = -1;

  function close() {
    menu.hidden = true;
    current?.button.setAttribute('aria-expanded', 'false');
    current = null;
    active = -1;
  }

  function highlight(index: number) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (!buttons.length) return;
    active = (index + buttons.length) % buttons.length;
    buttons.forEach((item, i) => {
      item.classList.toggle('active', i === active);
      item.setAttribute('aria-selected', String(i === active));
    });
    buttons[active].scrollIntoView({ block: 'nearest' });
  }

  function open(select: HTMLSelectElement, button: HTMLButtonElement) {
    if (current?.select === select && !menu.hidden) { close(); return; }
    close();
    current = { select, button };
    button.textContent = select.selectedOptions[0]?.textContent || select.options[0]?.textContent || '';
    menu.replaceChildren();
    [...select.options].forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'themed-select-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
      item.textContent = option.textContent;
      item.disabled = option.disabled;
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        button.textContent = option.textContent;
        close();
        button.focus();
      });
      menu.appendChild(item);
    });
    if (!select.options.length) { close(); return; }
    const rect = button.getBoundingClientRect();
    const height = Math.min(select.options.length * 34 + 8, 240);
    const above = window.innerHeight - rect.bottom < height + 8 && rect.top > height + 8;
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${above ? rect.top - height - 4 : rect.bottom + 4}px`;
    menu.style.width = `${Math.max(rect.width, 140)}px`;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    active = select.selectedIndex;
    highlight(active);
  }

  root.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
    const wrapper = document.createElement('span');
    wrapper.className = 'themed-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'themed-select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.textContent?.trim().replace(select.textContent || '', '').trim() || '选择');
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add('themed-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const sync = () => { button.textContent = select.selectedOptions[0]?.textContent || select.options[0]?.textContent || ''; button.disabled = select.disabled; };
    const observer = new MutationObserver(sync);
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });
    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
    button.addEventListener('click', () => open(select, button));
    button.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (current?.select !== select || menu.hidden) open(select, button);
        highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter' && current?.select === select && !menu.hidden) {
        event.preventDefault();
        menu.querySelectorAll<HTMLButtonElement>('[role="option"]')[active]?.click();
      }
    });
    sync();
  });

  document.addEventListener('pointerdown', event => {
    if (current && !current.button.contains(event.target as Node) && !menu.contains(event.target as Node)) close();
  });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', event => { if (event.target !== menu) close(); }, true);
}
