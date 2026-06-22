function initAuthSelect(select) {
  if (!select || select.dataset.customized === "true") return;

  select.dataset.customized = "true";
  select.classList.add("auth-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const wrapper = document.createElement("div");
  wrapper.className = "auth-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "auth-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const valueEl = document.createElement("span");
  valueEl.className = "auth-select-value";

  const icon = document.createElement("span");
  icon.className = "auth-select-icon";
  icon.setAttribute("aria-hidden", "true");

  trigger.append(valueEl, icon);

  const menu = document.createElement("ul");
  menu.className = "auth-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const optionItems = [...select.options].map((option, index) => {
    const item = document.createElement("li");
    item.className = "auth-select-option";
    item.setAttribute("role", "option");
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.setAttribute("aria-selected", index === select.selectedIndex ? "true" : "false");
    if (index === select.selectedIndex) item.classList.add("is-selected");
    menu.appendChild(item);
    return item;
  });

  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, trigger, menu);

  let activeIndex = select.selectedIndex;

  function syncDisplay() {
    const option = select.options[select.selectedIndex];
    valueEl.textContent = option ? option.textContent : "";
    optionItems.forEach((item, index) => {
      const selected = index === select.selectedIndex;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", selected ? "true" : "false");
    });
    activeIndex = select.selectedIndex;
  }

  function setOpen(open) {
    wrapper.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    menu.hidden = !open;
    if (!open) {
      optionItems.forEach((item) => item.classList.remove("is-active"));
      menu.style.position = "";
      menu.style.top = "";
      menu.style.left = "";
      menu.style.width = "";
      menu.style.right = "";
    } else {
      const rect = trigger.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.top = `${rect.bottom + 8}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.width = `${rect.width}px`;
      menu.style.right = "auto";
      const selectedItem = optionItems[select.selectedIndex];
      if (selectedItem) selectedItem.scrollIntoView({ block: "nearest" });
    }
  }

  function choose(index) {
    if (index < 0 || index >= optionItems.length) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncDisplay();
    setOpen(false);
    trigger.focus();
  }

  function highlight(index) {
    if (index < 0 || index >= optionItems.length) return;
    activeIndex = index;
    optionItems.forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === index);
    });
  }

  syncDisplay();

  trigger.addEventListener("click", () => {
    setOpen(!wrapper.classList.contains("is-open"));
  });

  optionItems.forEach((item, index) => {
    item.addEventListener("click", () => choose(index));
    item.addEventListener("mousemove", () => highlight(index));
  });

  trigger.addEventListener("keydown", (event) => {
    const isOpen = wrapper.classList.contains("is-open");

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setOpen(true);
        highlight(select.selectedIndex);
        return;
      }
      highlight(Math.min(activeIndex + 1, optionItems.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setOpen(true);
        highlight(select.selectedIndex);
        return;
      }
      highlight(Math.max(activeIndex - 1, 0));
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        setOpen(true);
        highlight(select.selectedIndex);
        return;
      }
      choose(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setOpen(false);
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (wrapper.classList.contains("is-open")) setOpen(true);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (wrapper.classList.contains("is-open")) setOpen(true);
    },
    true,
  );

  select.addEventListener("change", syncDisplay);
}

document.querySelectorAll(".auth-form select").forEach(initAuthSelect);
