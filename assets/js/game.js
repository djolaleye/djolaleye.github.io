(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("gameCanvas");
    const overlay = document.getElementById("gameOverlay");

    if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLDivElement)) {
      console.warn("[game] Missing #gameCanvas or #gameOverlay. Scaffold skipped.");
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      console.warn("[game] Unable to acquire 2D context. Scaffold skipped.");
      return;
    }

    const TILE_SIZE = 48;
    const TICK_RATE = 30;
    const FRAME_MS = 1000 / TICK_RATE;
    const STEP_DURATION_MS = 180;
    const TOAST_DURATION_MS = 1400;

    const MAP = {
      widthTiles: 28,
      heightTiles: 16,
      collisionTiles: [],
      hotspots: [
        { id: "home", label: "Home", x: 5, y: 2, w: 2, h: 2 },
        { id: "research", label: "Research / Data Projects", x: 11, y: 5, w: 2, h: 2 },
        { id: "software", label: "Software", x: 17, y: 7, w: 2, h: 2 },
        { id: "background", label: "Background", x: 22, y: 4, w: 2, h: 2 },
        { id: "contact", label: "Contact", x: 24, y: 11, w: 2, h: 2 }
      ]
    };

    const state = {
      time: {
        lastFrameMs: 0,
        frameMs: FRAME_MS,
        fpsCap: TICK_RATE
      },
      player: {
        tileX: 6,
        tileY: 5,
        fromTileX: 6,
        fromTileY: 5,
        toTileX: 6,
        toTileY: 5,
        worldX: 0,
        worldY: 0,
        direction: "down",
        isMoving: false,
        moveElapsedMs: 0,
        moveDurationMs: STEP_DURATION_MS
      },
      map: {
        tileSize: TILE_SIZE,
        widthTiles: MAP.widthTiles,
        heightTiles: MAP.heightTiles,
        blocked: new Set()
      },
      camera: {
        x: 0,
        y: 0,
        deadzoneX: TILE_SIZE * 1.5,
        deadzoneY: TILE_SIZE * 1.5,
        followLerp: 0.14
      },
      input: {
        held: new Set(),
        active: true
      },
      ui: {
        inRangeHotspotId: null,
        promptVisible: false,
        toastText: "",
        toastUntilMs: 0,
        activeModalId: null
      },
      content: {
        loaded: false,
        error: "",
        data: null
      },
      hotspots: MAP.hotspots
    };

    const overlayUi = {
      hud: null,
      modalLayer: null,
      modalBackdrop: null,
      modalPanel: null,
      modalBody: null,
      modalTitle: null,
      modalCloseBtn: null,
      modalFocusable: []
    };

    let lastFocusedElement = null;

    const controlledKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
      "W",
      "A",
      "S",
      "D",
      " ",
      "Space",
      "Spacebar"
    ]);

    const directionVectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };

    const keyToDirection = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right"
    };

    const REQUIRED_LOCATION_KEYS = ["home", "research", "software", "background", "contact"];

    const toTileKey = (x, y) => `${x},${y}`;
    const toWorld = (tile) => tile * state.map.tileSize;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    const isEditableElement = (el) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.tagName === "BUTTON" ||
        el.isContentEditable);

    const createElem = (tag, text, className) => {
      const node = document.createElement(tag);
      if (typeof text === "string") {
        node.textContent = text;
      }
      if (className) {
        node.className = className;
      }
      return node;
    };

    const getThemeColor = (varName, fallback) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      return value || fallback;
    };

    const getComputedFallback = (propertyName) => {
      const value = getComputedStyle(document.body).getPropertyValue(propertyName).trim();
      return value || "currentColor";
    };

    const initOverlayDom = () => {
      overlay.replaceChildren();
      overlay.style.pointerEvents = "auto";

      overlayUi.hud = createElem("div", "", "game-hud");
      overlayUi.hud.style.pointerEvents = "none";
      overlayUi.hud.style.borderRadius = "0";
      overlayUi.hud.style.outline = "2px solid var(--border)";
      overlayUi.hud.style.outlineOffset = "1px";
      overlayUi.hud.style.textTransform = "uppercase";
      overlayUi.hud.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

      overlayUi.modalLayer = createElem("div");
      overlayUi.modalLayer.style.position = "absolute";
      overlayUi.modalLayer.style.inset = "0";
      overlayUi.modalLayer.style.display = "none";
      overlayUi.modalLayer.style.pointerEvents = "none";
      overlayUi.modalLayer.setAttribute("aria-hidden", "true");

      overlay.append(overlayUi.hud, overlayUi.modalLayer);
    };

    const setHudText = (text) => {
      if (overlayUi.hud) {
        overlayUi.hud.textContent = text;
      }
    };

    const setToast = (text, durationMs = TOAST_DURATION_MS) => {
      state.ui.toastText = text;
      state.ui.toastUntilMs = performance.now() + durationMs;
    };

    const syncGameActiveState = () => {
      const active = document.activeElement;
      const blockedByFocus = isEditableElement(active);
      const blockedByModal = Boolean(state.ui.activeModalId);
      state.input.active = !blockedByFocus && !blockedByModal;
      if (!state.input.active) {
        state.input.held.clear();
      }
    };

    const resizeCanvasToDisplaySize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const displayWidth = Math.max(1, Math.floor(rect.width));
      const displayHeight = Math.max(1, Math.floor(rect.height));

      canvas.width = Math.floor(displayWidth * dpr);
      canvas.height = Math.floor(displayHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const playerCenterX = state.player.worldX + state.map.tileSize / 2;
      const playerCenterY = state.player.worldY + state.map.tileSize / 2;
      state.camera.x = playerCenterX - displayWidth / 2;
      state.camera.y = playerCenterY - displayHeight / 2;
      clampCameraToBounds(displayWidth, displayHeight);
    };

    const seedCollisionMap = () => {
      for (let x = 0; x < state.map.widthTiles; x += 1) {
        state.map.blocked.add(toTileKey(x, 0));
        state.map.blocked.add(toTileKey(x, state.map.heightTiles - 1));
      }
      for (let y = 0; y < state.map.heightTiles; y += 1) {
        state.map.blocked.add(toTileKey(0, y));
        state.map.blocked.add(toTileKey(state.map.widthTiles - 1, y));
      }
      for (let y = 3; y <= 11; y += 1) {
        state.map.blocked.add(toTileKey(9, y));
      }
      for (let x = 14; x <= 21; x += 1) {
        state.map.blocked.add(toTileKey(x, 10));
      }
      for (const tile of MAP.collisionTiles) {
        state.map.blocked.add(toTileKey(tile.x, tile.y));
      }
      state.map.blocked.delete(toTileKey(state.player.tileX, state.player.tileY));
      for (const spot of state.hotspots) {
        for (let x = spot.x; x < spot.x + spot.w; x += 1) {
          for (let y = spot.y; y < spot.y + spot.h; y += 1) {
            state.map.blocked.delete(toTileKey(x, y));
          }
        }
      }
    };

    const isWalkableTile = (x, y) => {
      if (x < 0 || y < 0 || x >= state.map.widthTiles || y >= state.map.heightTiles) {
        return false;
      }
      return !state.map.blocked.has(toTileKey(x, y));
    };

    const getMovementIntent = () => {
      const priority = ["ArrowUp", "w", "W", "ArrowLeft", "a", "A", "ArrowDown", "s", "S", "ArrowRight", "d", "D"];
      for (const key of priority) {
        if (state.input.held.has(key)) {
          return keyToDirection[key] || null;
        }
      }
      return null;
    };

    const startMoveIfPossible = (direction) => {
      if (state.player.isMoving || state.ui.activeModalId) {
        return;
      }
      if (!direction) {
        return;
      }

      const v = directionVectors[direction];
      if (!v) {
        return;
      }

      const toX = state.player.tileX + v.x;
      const toY = state.player.tileY + v.y;
      state.player.direction = direction;

      if (!isWalkableTile(toX, toY)) {
        return;
      }

      state.player.fromTileX = state.player.tileX;
      state.player.fromTileY = state.player.tileY;
      state.player.toTileX = toX;
      state.player.toTileY = toY;
      state.player.isMoving = true;
      state.player.moveElapsedMs = 0;
    };

    const updatePlayer = (deltaMs) => {
      if (state.ui.activeModalId) {
        state.player.worldX = toWorld(state.player.tileX);
        state.player.worldY = toWorld(state.player.tileY);
        return;
      }

      if (!state.player.isMoving) {
        startMoveIfPossible(getMovementIntent());
      }

      if (!state.player.isMoving) {
        state.player.worldX = toWorld(state.player.tileX);
        state.player.worldY = toWorld(state.player.tileY);
        return;
      }

      state.player.moveElapsedMs += deltaMs;
      const t = clamp(state.player.moveElapsedMs / state.player.moveDurationMs, 0, 1);

      const fromX = toWorld(state.player.fromTileX);
      const fromY = toWorld(state.player.fromTileY);
      const toX = toWorld(state.player.toTileX);
      const toY = toWorld(state.player.toTileY);

      state.player.worldX = lerp(fromX, toX, t);
      state.player.worldY = lerp(fromY, toY, t);

      if (t >= 1) {
        state.player.tileX = state.player.toTileX;
        state.player.tileY = state.player.toTileY;
        state.player.worldX = toX;
        state.player.worldY = toY;
        state.player.isMoving = false;
        state.player.moveElapsedMs = 0;
      }
    };

    const findHotspotById = (id) => state.hotspots.find((spot) => spot.id === id) || null;

    const findHotspotByTile = (tileX, tileY) =>
      state.hotspots.find(
        (spot) => tileX >= spot.x && tileX < spot.x + spot.w && tileY >= spot.y && tileY < spot.y + spot.h
      ) || null;

    const getHotspotRangeDistance = (spot) => {
      const nearestX = clamp(state.player.tileX, spot.x, spot.x + spot.w - 1);
      const nearestY = clamp(state.player.tileY, spot.y, spot.y + spot.h - 1);
      return Math.abs(nearestX - state.player.tileX) + Math.abs(nearestY - state.player.tileY);
    };

    const updateUIState = () => {
      const inRange = state.hotspots.find((spot) => getHotspotRangeDistance(spot) <= 1);
      state.ui.inRangeHotspotId = inRange ? inRange.id : null;
      state.ui.promptVisible = Boolean(inRange);
    };

    const validateContentSchema = (payload) => {
      if (!payload || typeof payload !== "object") {
        return false;
      }
      if (!payload.meta || typeof payload.meta !== "object") {
        return false;
      }
      if (!payload.locations || typeof payload.locations !== "object") {
        return false;
      }
      for (const key of REQUIRED_LOCATION_KEYS) {
        if (!payload.locations[key] || typeof payload.locations[key] !== "object") {
          return false;
        }
      }
      if (!Array.isArray(payload.meta.social)) {
        return false;
      }
      return true;
    };

    const fetchContentJson = async () => {
      const candidates = ["/data/content.json", "data/content.json"];
      let lastError = null;

      for (const path of candidates) {
        try {
          const response = await fetch(path, { cache: "no-store" });
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }
          const payload = await response.json();
          if (!validateContentSchema(payload)) {
            throw new Error("Schema validation failed");
          }
          return payload;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("Failed to fetch content.json");
    };

    const getFocusableElements = (container) => {
      if (!(container instanceof HTMLElement)) {
        return [];
      }
      const selectors = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
      ];
      return Array.from(container.querySelectorAll(selectors.join(","))).filter(
        (el) => el instanceof HTMLElement && !el.hasAttribute("disabled")
      );
    };

    const trapFocusInModal = (event) => {
      if (event.key !== "Tab" || !state.ui.activeModalId || !overlayUi.modalPanel) {
        return false;
      }

      overlayUi.modalFocusable = getFocusableElements(overlayUi.modalPanel);
      if (overlayUi.modalFocusable.length === 0) {
        event.preventDefault();
        overlayUi.modalPanel.focus();
        return true;
      }

      const first = overlayUi.modalFocusable[0];
      const last = overlayUi.modalFocusable[overlayUi.modalFocusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return true;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    };

    const clearModal = () => {
      if (!overlayUi.modalLayer) {
        return;
      }
      overlayUi.modalLayer.replaceChildren();
      overlayUi.modalLayer.style.display = "none";
      overlayUi.modalLayer.style.pointerEvents = "none";
      overlayUi.modalLayer.setAttribute("aria-hidden", "true");
      overlayUi.modalBackdrop = null;
      overlayUi.modalPanel = null;
      overlayUi.modalBody = null;
      overlayUi.modalTitle = null;
      overlayUi.modalCloseBtn = null;
      overlayUi.modalFocusable = [];
      state.ui.activeModalId = null;
      syncGameActiveState();
      if (lastFocusedElement instanceof HTMLElement) {
        lastFocusedElement.focus();
      } else {
        canvas.focus();
      }
      lastFocusedElement = null;
    };

    const makeLink = (label, url) => {
      const link = createElem("a", label || "Open link");
      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.href = "#";
        link.addEventListener("click", (event) => event.preventDefault());
      }
      link.style.color = "var(--link)";
      return link;
    };

    const appendTagList = (parent, tags) => {
      if (!Array.isArray(tags) || tags.length === 0) {
        return;
      }
      const wrap = createElem("div");
      wrap.style.display = "flex";
      wrap.style.flexWrap = "wrap";
      wrap.style.gap = "0.4rem";

      for (const tag of tags) {
        const chip = createElem("span", tag || "Tag");
        chip.style.border = "1px solid var(--border)";
        chip.style.padding = "0.15rem 0.45rem";
        chip.style.borderRadius = "999px";
        chip.style.fontSize = "0.75rem";
        wrap.append(chip);
      }
      parent.append(wrap);
    };

    const appendItemLinks = (parent, links) => {
      if (!Array.isArray(links) || links.length === 0) {
        return;
      }
      const row = createElem("div");
      row.style.display = "flex";
      row.style.flexWrap = "wrap";
      row.style.gap = "0.6rem";
      for (const link of links) {
        row.append(makeLink(link.label, link.url));
      }
      parent.append(row);
    };

    const appendHomeContent = (body, location) => {
      body.append(createElem("h3", location.subtitle || ""));
      body.append(createElem("p", location.blurb || ""));

      if (Array.isArray(location.highlights) && location.highlights.length > 0) {
        const list = createElem("ul");
        for (const item of location.highlights) {
          const li = createElem("li", `${item.label || "Detail"}: ${item.value || ""}`);
          list.append(li);
        }
        body.append(list);
      }

      if (Array.isArray(location.cta) && location.cta.length > 0) {
        const row = createElem("div");
        row.style.display = "flex";
        row.style.flexWrap = "wrap";
        row.style.gap = "0.6rem";
        for (const cta of location.cta) {
          row.append(makeLink(cta.label, cta.url));
        }
        body.append(row);
      }
    };

    const appendCollectionContent = (body, location) => {
      if (location.intro) {
        body.append(createElem("p", location.intro));
      }
      const items = Array.isArray(location.items) ? location.items : [];
      for (const item of items) {
        const card = createElem("article");
        card.style.border = "1px solid var(--border)";
        card.style.borderRadius = "0.5rem";
        card.style.padding = "0.65rem";
        card.style.marginBottom = "0.65rem";

        card.append(createElem("h3", item.name || "Untitled"));
        card.append(createElem("p", item.summary || ""));
        appendTagList(card, item.tags);
        appendItemLinks(card, item.links);

        body.append(card);
      }
    };

    const appendBackgroundContent = (body, location) => {
      const timeline = Array.isArray(location.timeline) ? location.timeline : [];
      for (const entry of timeline) {
        const row = createElem("article");
        row.style.borderLeft = "3px solid var(--border)";
        row.style.paddingLeft = "0.65rem";
        row.style.marginBottom = "0.85rem";

        row.append(createElem("p", entry.when || ""));
        row.append(createElem("h3", entry.title || ""));

        const details = Array.isArray(entry.details) ? entry.details : [];
        if (details.length > 0) {
          const list = createElem("ul");
          for (const detail of details) {
            list.append(createElem("li", detail || ""));
          }
          row.append(list);
        }
        body.append(row);
      }
    };

    const appendContactContent = (body, location) => {
      const methods = Array.isArray(location.methods) ? location.methods : [];
      for (const method of methods) {
        const row = createElem("p");
        row.append(createElem("strong", `${method.label || "Contact"}: `));
        if (method.url) {
          row.append(makeLink(method.value || method.url, method.url));
        } else {
          row.append(document.createTextNode(method.value || ""));
        }
        body.append(row);
      }
    };

    const openHotspotModal = (locationId) => {
      if (!state.content.loaded || !state.content.data) {
        setToast("Content is still loading");
        return;
      }

      const location = state.content.data.locations[locationId];
      if (!location) {
        setToast("No content found for this location");
        return;
      }

      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlayUi.modalLayer.replaceChildren();

      const backdrop = createElem("div");
      backdrop.style.position = "absolute";
      backdrop.style.inset = "0";
      backdrop.style.display = "flex";
      backdrop.style.alignItems = "center";
      backdrop.style.justifyContent = "center";
      backdrop.style.padding = "1rem";
      backdrop.style.background = "var(--bg-soft)";
      backdrop.style.opacity = "0.98";
      backdrop.addEventListener("click", clearModal);

      const panel = createElem("section", "", "card");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("tabindex", "-1");
      panel.style.width = "min(760px, 100%)";
      panel.style.maxHeight = "90vh";
      panel.style.overflow = "auto";
      panel.style.border = "1px solid var(--border)";
      panel.style.borderRadius = "0";
      panel.style.outline = "2px solid var(--border)";
      panel.style.outlineOffset = "2px";
      panel.style.padding = "1rem";
      panel.style.background = "var(--card)";
      panel.style.color = "var(--text)";
      panel.style.boxShadow = "var(--shadow)";
      panel.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      panel.addEventListener("click", (event) => event.stopPropagation());

      const header = createElem("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.gap = "0.75rem";

      const title = createElem("h2", location.title || locationId);
      title.style.margin = "0";

      const closeBtn = createElem("button", "Close", "btn");
      closeBtn.type = "button";
      closeBtn.style.border = "1px solid var(--border)";
      closeBtn.style.background = "transparent";
      closeBtn.style.color = "var(--text)";
      closeBtn.style.borderRadius = "0";
      closeBtn.style.padding = "0.35rem 0.65rem";
      closeBtn.addEventListener("click", clearModal);

      header.append(title, closeBtn);
      panel.append(header);

      const body = createElem("div");
      body.style.marginTop = "0.85rem";

      if (locationId === "home") {
        appendHomeContent(body, location);
      } else if (locationId === "research" || locationId === "software") {
        appendCollectionContent(body, location);
      } else if (locationId === "background") {
        appendBackgroundContent(body, location);
      } else if (locationId === "contact") {
        appendContactContent(body, location);
      }

      panel.append(body);
      backdrop.append(panel);
      overlayUi.modalLayer.append(backdrop);

      overlayUi.modalLayer.style.display = "block";
      overlayUi.modalLayer.style.pointerEvents = "auto";
      overlayUi.modalLayer.setAttribute("aria-hidden", "false");
      overlayUi.modalBackdrop = backdrop;
      overlayUi.modalPanel = panel;
      overlayUi.modalBody = body;
      overlayUi.modalTitle = title;
      overlayUi.modalCloseBtn = closeBtn;
      overlayUi.modalFocusable = getFocusableElements(panel);
      state.ui.activeModalId = locationId;
      state.input.held.clear();
      syncGameActiveState();
      if (overlayUi.modalCloseBtn instanceof HTMLElement) {
        overlayUi.modalCloseBtn.focus();
      } else {
        panel.focus();
      }
    };

    const openHotspotByObject = (hotspot) => {
      if (!hotspot) {
        return;
      }
      openHotspotModal(hotspot.id);
    };

    const interactIfInRange = () => {
      const hotspot = findHotspotById(state.ui.inRangeHotspotId);
      if (!hotspot) {
        setToast("Move closer to a hotspot");
        return;
      }
      openHotspotByObject(hotspot);
    };

    const getViewportSize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      return {
        width: canvas.width / dpr,
        height: canvas.height / dpr
      };
    };

    const clampCameraToBounds = (width, height) => {
      const worldWidth = state.map.widthTiles * state.map.tileSize;
      const worldHeight = state.map.heightTiles * state.map.tileSize;
      state.camera.x = clamp(state.camera.x, 0, Math.max(0, worldWidth - width));
      state.camera.y = clamp(state.camera.y, 0, Math.max(0, worldHeight - height));
    };

    const updateCamera = () => {
      const { width, height } = getViewportSize();
      const playerCenterX = state.player.worldX + state.map.tileSize / 2;
      const playerCenterY = state.player.worldY + state.map.tileSize / 2;
      const viewportCenterX = state.camera.x + width / 2;
      const viewportCenterY = state.camera.y + height / 2;

      const deadzoneLeft = viewportCenterX - state.camera.deadzoneX;
      const deadzoneRight = viewportCenterX + state.camera.deadzoneX;
      const deadzoneTop = viewportCenterY - state.camera.deadzoneY;
      const deadzoneBottom = viewportCenterY + state.camera.deadzoneY;

      let targetCenterX = viewportCenterX;
      let targetCenterY = viewportCenterY;

      if (playerCenterX < deadzoneLeft) {
        targetCenterX = playerCenterX + state.camera.deadzoneX;
      } else if (playerCenterX > deadzoneRight) {
        targetCenterX = playerCenterX - state.camera.deadzoneX;
      }

      if (playerCenterY < deadzoneTop) {
        targetCenterY = playerCenterY + state.camera.deadzoneY;
      } else if (playerCenterY > deadzoneBottom) {
        targetCenterY = playerCenterY - state.camera.deadzoneY;
      }

      const targetX = targetCenterX - width / 2;
      const targetY = targetCenterY - height / 2;

      state.camera.x = lerp(state.camera.x, targetX, state.camera.followLerp);
      state.camera.y = lerp(state.camera.y, targetY, state.camera.followLerp);
      clampCameraToBounds(width, height);
    };

    const updateHudText = (nowMs) => {
      if (state.ui.toastText && nowMs <= state.ui.toastUntilMs) {
        setHudText(state.ui.toastText);
        return;
      }

      if (state.ui.toastText && nowMs > state.ui.toastUntilMs) {
        state.ui.toastText = "";
        state.ui.toastUntilMs = 0;
      }

      if (state.ui.activeModalId) {
        setHudText("Modal open (ESC to close)");
        return;
      }

      if (!state.content.loaded && !state.content.error) {
        setHudText("Loading content data...");
        return;
      }

      if (state.content.error) {
        setHudText("Content unavailable; gameplay remains active");
        return;
      }

      if (state.ui.promptVisible && state.ui.inRangeHotspotId) {
        const spot = findHotspotById(state.ui.inRangeHotspotId);
        if (spot) {
          setHudText(`Press SPACE / Tap to interact: ${spot.label}`);
          return;
        }
      }

      setHudText("Move: WASD / Arrows | Interact: SPACE / Tap");
    };

    const update = (deltaMs, nowMs) => {
      updatePlayer(deltaMs);
      updateCamera();
      updateUIState();
      updateHudText(nowMs);
    };

    const drawWorld = () => {
      const width = canvas.width / Math.max(1, window.devicePixelRatio || 1);
      const height = canvas.height / Math.max(1, window.devicePixelRatio || 1);

      const bg = getThemeColor("--bg-soft", getThemeColor("--bg", getComputedFallback("background-color")));
      const border = getThemeColor("--border", getThemeColor("--text", getComputedFallback("color")));
      const text = getThemeColor("--text", getComputedFallback("color"));
      const card = getThemeColor("--card", bg);

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(-state.camera.x, -state.camera.y);

      const tileSize = state.map.tileSize;
      const worldWidth = state.map.widthTiles * tileSize;
      const worldHeight = state.map.heightTiles * tileSize;

      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.28;
      for (let x = 0; x <= state.map.widthTiles; x += 1) {
        const px = x * tileSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, worldHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= state.map.heightTiles; y += 1) {
        const py = y * tileSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(worldWidth, py);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = card;
      for (const spot of state.hotspots) {
        const x = toWorld(spot.x);
        const y = toWorld(spot.y);
        const w = spot.w * tileSize;
        const h = spot.h * tileSize;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);

        const centerX = x + w / 2;
        const centerY = y + h / 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.max(4, tileSize * 0.12), 0, Math.PI * 2);
        ctx.fillStyle = text;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = border;
      for (const key of state.map.blocked) {
        const [tx, ty] = key.split(",").map(Number);
        ctx.fillRect(tx * tileSize + 10, ty * tileSize + 10, tileSize - 20, tileSize - 20);
      }

      // Placeholder player sprite (Phase H):
      // Draws a simple retro block sprite until an external sprite sheet is wired.
      // Sprite-sheet drop-in target:
      // - path: /images/sprites/player.png
      // - layout: rows=4 directions (down,left,right,up), cols=3 frames (idle,walk1,walk2)
      // - frame size: 32x32 px
      // To replace this placeholder, load the sheet once and draw the selected frame at player position.
      ctx.fillStyle = text;
      ctx.fillRect(state.player.worldX + 6, state.player.worldY + 6, tileSize - 12, tileSize - 12);
      ctx.fillStyle = card;
      ctx.fillRect(state.player.worldX + 14, state.player.worldY + 14, tileSize - 28, tileSize - 28);
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.strokeRect(state.player.worldX + 6, state.player.worldY + 6, tileSize - 12, tileSize - 12);

      ctx.restore();

      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2));

      ctx.fillStyle = text;
      ctx.font = "600 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("Phase F Content + Modal Renderer (30 FPS)", 12, 12);
    };

    const loop = (timestampMs) => {
      const last = state.time.lastFrameMs || timestampMs;
      const elapsedMs = timestampMs - last;
      if (elapsedMs < state.time.frameMs) {
        window.requestAnimationFrame(loop);
        return;
      }

      state.time.lastFrameMs = timestampMs;
      const deltaMs = Math.min(250, elapsedMs);
      update(deltaMs, timestampMs);
      drawWorld();

      window.requestAnimationFrame(loop);
    };

    const preventScrollIfGameActive = (event) => {
      if (!controlledKeys.has(event.key)) {
        return false;
      }
      if (!state.input.active && !state.ui.activeModalId) {
        return false;
      }
      event.preventDefault();
      return true;
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape" && state.ui.activeModalId) {
        event.preventDefault();
        clearModal();
        return;
      }
      if (state.ui.activeModalId && trapFocusInModal(event)) {
        return;
      }

      if (!state.input.active) {
        return;
      }

      preventScrollIfGameActive(event);
      if (event.repeat) {
        return;
      }
      state.input.held.add(event.key);

      if (event.key === " " || event.key === "Space" || event.key === "Spacebar") {
        interactIfInRange();
      }
    };

    const onKeyUp = (event) => {
      preventScrollIfGameActive(event);
      state.input.held.delete(event.key);
    };

    const onCanvasTap = (event) => {
      if (state.ui.activeModalId) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left + state.camera.x;
      const py = event.clientY - rect.top + state.camera.y;
      const tileX = Math.floor(px / state.map.tileSize);
      const tileY = Math.floor(py / state.map.tileSize);
      const tappedHotspot = findHotspotByTile(tileX, tileY);

      if (tappedHotspot) {
        const inRange = tappedHotspot.id === state.ui.inRangeHotspotId;
        if (inRange) {
          openHotspotByObject(tappedHotspot);
        } else {
          setToast("Hotspot tapped. Move closer to interact");
        }
        return;
      }

      interactIfInRange();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        state.input.held.clear();
      }
    };

    const loadContentData = async () => {
      try {
        const payload = await fetchContentJson();
        state.content.data = payload;
        state.content.loaded = true;
        state.content.error = "";
      } catch (error) {
        state.content.loaded = false;
        state.content.error = error instanceof Error ? error.message : "Unknown fetch error";
        console.warn("[game] content.json load failed:", state.content.error);
        setToast("Failed to load content data");
      }
    };

    state.player.worldX = toWorld(state.player.tileX);
    state.player.worldY = toWorld(state.player.tileY);
    seedCollisionMap();

    // Placeholder asset drop-ins for later phases:
    // - Player sprite sheet:
    //   path: /images/sprites/player.png
    //   layout: rows=4 directions (down,left,right,up), cols=3 frames (idle,walk1,walk2)
    //   frame size: 32x32 px
    // - World tileset:
    //   path: /images/tiles/tileset.png
    //   tile size: 32x32 px per tile in a regular grid atlas
    //   replacement note: swap grid/wall fillRect calls in drawWorld() for drawImage() tile lookups.
    //   keep collision logic mapped to tile coordinates; only rendering should change.
    // - Optional FX/SFX folder: assets/audio/game/*.mp3 or *.wav
    //   Keep filenames stable for easy swapping without logic changes

    initOverlayDom();
    setHudText("Loading content data...");
    resizeCanvasToDisplaySize();
    syncGameActiveState();
    update(0, performance.now());
    drawWorld();

    canvas.setAttribute("tabindex", "0");
    canvas.addEventListener("pointerdown", onCanvasTap);
    window.addEventListener("focusin", syncGameActiveState);
    window.addEventListener("focusout", syncGameActiveState);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    window.addEventListener("resize", resizeCanvasToDisplaySize);
    window.addEventListener("orientationchange", resizeCanvasToDisplaySize);

    loadContentData();
    window.requestAnimationFrame(loop);
  });
})();
