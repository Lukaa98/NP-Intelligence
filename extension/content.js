(function npIntelligenceContentScript() {
  function findLikelyGameNumber() {
    const url = new URL(window.location.href);
    const direct =
      url.searchParams.get("game_number") ||
      url.searchParams.get("game") ||
      url.searchParams.get("gameNumber");

    if (direct) {
      return String(direct);
    }

    const patterns = [/game/i, /universe/i];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !patterns.some((pattern) => pattern.test(key))) {
        continue;
      }

      const value = window.localStorage.getItem(key);
      const match = String(value || "").match(/\b\d{3,8}\b/);
      if (match) {
        return match[0];
      }
    }

    return "";
  }

  function findLikelyApiKey() {
    const candidates = [];
    const keyPattern = /(code|token|key|auth)/i;

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !keyPattern.test(key)) {
        continue;
      }

      const value = String(window.localStorage.getItem(key) || "").trim();
      if (value.length >= 8) {
        candidates.push({ key, value });
      }
    }

    candidates.sort((left, right) => right.value.length - left.value.length);
    return candidates[0]?.value || "";
  }

  function collectHints() {
    const storage = {};
    const patterns = /(game|universe|code|token|key|auth)/i;

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !patterns.test(key)) {
        continue;
      }

      storage[key] = window.localStorage.getItem(key);
    }

    return {
      href: window.location.href,
      title: document.title,
      gameNumber: findLikelyGameNumber(),
      apiKey: findLikelyApiKey(),
      storage
    };
  }

  function activeEditableElement() {
    const element = document.activeElement;
    if (!element) {
      return null;
    }

    if (element instanceof HTMLTextAreaElement) {
      return element;
    }

    if (element instanceof HTMLInputElement && /^(text|search|url)$/i.test(element.type || "text")) {
      return element;
    }

    if (element.isContentEditable) {
      return element;
    }

    return null;
  }

  function insertReferenceMarkup(referenceName) {
    const mention = `[[${referenceName}]]`;
    const element = activeEditableElement();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      const before = element.value.slice(0, start);
      const after = element.value.slice(end);
      const spacerBefore = before && !/\s$/.test(before) ? " " : "";
      const spacerAfter = after && !/^\s/.test(after) ? " " : "";
      element.value = `${before}${spacerBefore}${mention}${spacerAfter}${after}`;
      const cursor = before.length + spacerBefore.length + mention.length;
      element.focus();
      element.setSelectionRange(cursor, cursor);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, mode: "inserted", mention };
    }

    if (element?.isContentEditable) {
      document.execCommand("insertText", false, `${mention} `);
      return { ok: true, mode: "inserted", mention };
    }

    return { ok: false, mode: "missing-input", mention };
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function interactiveElements() {
    return [...document.querySelectorAll("button, [role='button'], a, div, span")].filter(isVisible);
  }

  function normalizedText(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function clickElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return true;
  }

  function clickPointerTarget(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0
      }));
    }

    return true;
  }

  function findElementByText(pattern, options = {}) {
    const exact = Boolean(options.exact);
    const matcher = typeof pattern === "string"
      ? new RegExp(exact ? `^${escapeRegExp(pattern)}$` : escapeRegExp(pattern), "i")
      : pattern;

    return interactiveElements().find((element) => matcher.test(normalizedText(element)));
  }

  function findHeading(pattern) {
    const matcher = typeof pattern === "string" ? new RegExp(escapeRegExp(pattern), "i") : pattern;
    return [...document.querySelectorAll("h1, h2, h3, div, span")].find((element) => isVisible(element) && matcher.test(normalizedText(element)));
  }

  function findPlayerRow(playerName) {
    const candidates = [...document.querySelectorAll("button, [role='button'], div, li, article")].filter((element) => {
      if (!isVisible(element)) {
        return false;
      }
      const text = normalizedText(element);
      return text.includes(playerName);
    });

    return candidates
      .sort((left, right) => left.getBoundingClientRect().height - right.getBoundingClientRect().height)
      .find((element) => normalizedText(element).includes(playerName)) || null;
  }

  function exactVisibleTextMatches(referenceName) {
    const normalizedReference = String(referenceName || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalizedReference) {
      return [];
    }

    return [...document.querySelectorAll("span, div, p, text, button, a")]
      .filter(isVisible)
      .filter((element) => normalizedText(element).toLowerCase() === normalizedReference)
      .sort((left, right) => left.getBoundingClientRect().width * left.getBoundingClientRect().height - right.getBoundingClientRect().width * right.getBoundingClientRect().height);
  }

  function clickableReferenceTarget(referenceName) {
    const matches = exactVisibleTextMatches(referenceName);
    for (const match of matches) {
      if (match instanceof HTMLElement && match.onclick) {
        return match;
      }

      let current = match;
      while (current instanceof HTMLElement && current !== document.body) {
        if (current.onclick || current.role === "button" || current.tagName === "BUTTON" || current.tagName === "A") {
          return current;
        }
        current = current.parentElement;
      }
    }

    return matches[0] || null;
  }

  function likelyEyeButton(row) {
    if (!(row instanceof Element)) {
      return null;
    }

    const buttons = [...row.querySelectorAll("button, [role='button']")].filter(isVisible);
    if (buttons.length) {
      return buttons[buttons.length - 1];
    }

    let sibling = row.nextElementSibling;
    while (sibling) {
      const nested = sibling.querySelector?.("button, [role='button']");
      if (nested && isVisible(nested)) {
        return nested;
      }
      sibling = sibling.nextElementSibling;
    }

    return null;
  }

  async function openLeaderboardView() {
    if (findHeading(/leaderboard/i)) {
      return true;
    }

    const menuButton =
      findElementByText(/^\u2630$/) ||
      findElementByText(/menu/i, { exact: true }) ||
      interactiveElements().find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 140 && rect.top < 140;
      });

    if (menuButton) {
      clickElement(menuButton);
      await sleep(250);
    }

    const leaderboardButton =
      findElementByText(/leaderboard/i) ||
      findElementByText(/empires/i) ||
      findElementByText(/players/i);

    if (leaderboardButton) {
      clickElement(leaderboardButton);
      await sleep(350);
    }

    return Boolean(findHeading(/leaderboard|empires|players/i));
  }

  async function focusPlayer(playerName) {
    const name = String(playerName || "").trim();
    if (!name) {
      return { ok: false, detail: "Missing player name." };
    }

    await openLeaderboardView();

    let row = findPlayerRow(name);
    if (!row) {
      await sleep(400);
      row = findPlayerRow(name);
    }

    if (!row) {
      return { ok: false, detail: `Could not find ${name} in the visible leaderboard yet.` };
    }

    const eyeButton = likelyEyeButton(row);
    if (eyeButton) {
      clickElement(eyeButton);
      await sleep(250);
      return { ok: true, mode: "eye-button" };
    }

    if (clickElement(row instanceof HTMLElement ? row : null)) {
      await sleep(250);
      return { ok: true, mode: "row-click" };
    }

    return { ok: false, detail: `Found ${name}, but could not find a clickable profile control.` };
  }

  async function focusReference(referenceName) {
    const name = String(referenceName || "").trim();
    if (!name) {
      return { ok: false, detail: "Missing reference name." };
    }

    const directTarget = clickableReferenceTarget(name);
    if (directTarget && clickPointerTarget(directTarget)) {
      await sleep(250);
      return { ok: true, mode: "direct-reference" };
    }

    const playerResult = await focusPlayer(name);
    if (playerResult?.ok) {
      return playerResult;
    }

    const insertResult = insertReferenceMarkup(name);
    if (insertResult.ok) {
      return insertResult;
    }

    return { ok: false, detail: `Could not find or focus ${name} in the visible game view yet.` };
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "NP_CAPTURE_HINTS") {
      sendResponse({ ok: true, hints: collectHints() });
      return false;
    }

    if (message.type === "NP_INSERT_REFERENCE") {
      const referenceName = String(message.referenceName || "").trim();
      if (!referenceName) {
        sendResponse({ ok: false, error: "Missing referenceName." });
        return false;
      }

      sendResponse(insertReferenceMarkup(referenceName));
      return false;
    }

    if (message.type === "NP_FOCUS_PLAYER") {
      focusPlayer(message.playerName)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, detail: error.message || "Could not focus player." }));
      return true;
    }

    if (message.type === "NP_FOCUS_REFERENCE") {
      focusReference(message.referenceName)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, detail: error.message || "Could not focus reference." }));
      return true;
    }

    return false;
  });
})();
