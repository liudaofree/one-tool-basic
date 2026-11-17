export function createGroupCombobox(input: HTMLInputElement, menu: HTMLDivElement, trigger: HTMLButtonElement) {
  let groups: string[] = [];
  let visible: string[] = [];
  let active = -1;
  const wrapper = input.parentElement!;

  function close() {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function choose(group: string) {
    input.value = group;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    input.focus();
  }

  function highlight(index: number) {
    active = index;
    menu.querySelectorAll<HTMLButtonElement>('[role="option"]').forEach((option, i) => {
      option.classList.toggle('active', i === index);
      option.setAttribute('aria-selected', String(i === index));
    });
  }

  function open(showAll = false) {
    const query = input.value.trim().toLocaleLowerCase();
    visible = showAll ? groups : groups.filter(group => group.toLocaleLowerCase().includes(query));
    menu.replaceChildren();
    visible.forEach(group => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'group-combobox-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = group;
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => choose(group));
      menu.appendChild(option);
    });
    menu.hidden = visible.length === 0;
    input.setAttribute('aria-expanded', String(!menu.hidden));
    active = -1;
  }

  input.addEventListener('focus', () => open());
  input.addEventListener('input', () => open());
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) open(true);
      if (visible.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length);
    } else if (event.key === 'Enter' && !menu.hidden && active >= 0) {
      event.preventDefault();
      choose(visible[active]);
    }
  });
  trigger.addEventListener('click', () => {
    if (menu.hidden) { input.focus(); open(true); }
    else close();
  });
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target as Node)) close();
  });

  return {
    setGroups(next: string[]) { groups = next; close(); },
    close,
  };
}
