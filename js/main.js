import { scenarios } from "./scenarios.js";
import { createStage } from "./scene.js";
import { queries, compareScripts, compareFocus } from "./queries.js";
import { termsIn } from "./terms.js";

const scenarioList = document.querySelector("#scenario-list");
const stepList = document.querySelector("#step-list");
const viewport = document.querySelector("#viewport");
const stage = createStage(viewport);

const els = {
  kicker: document.querySelector("#kicker"),
  title: document.querySelector("#step-title"),
  plain: document.querySelector("#step-plain"),
  body: document.querySelector("#step-body"),
  codeFold: document.querySelector("#code-fold"),
  code: document.querySelector("#step-code code"),
  sql: document.querySelector("#step-sql"),
  sqlLabel: document.querySelector("#sql-label"),
  termBox: document.querySelector("#term-box"),
  termList: document.querySelector("#term-list"),
  compare: document.querySelector("#sql-compare"),
  compareNote: document.querySelector("#compare-note"),
  compareSummary: document.querySelector("#compare-summary"),
  callout: document.querySelector("#step-callout"),
  acid: document.querySelector("#acid"),
  caption: document.querySelector("#hud-caption"),
  prev: document.querySelector("#btn-prev"),
  next: document.querySelector("#btn-next"),
  play: document.querySelector("#btn-play"),
  reset: document.querySelector("#btn-reset-view"),
  committed: document.querySelector("#stat-committed-stock"),
  view: document.querySelector("#stat-view-stock"),
  viewNote: document.querySelector("#stat-view-note"),
  orders: document.querySelector("#stat-orders"),
  ordersNote: document.querySelector("#stat-orders-note"),
  tx: document.querySelector("#stat-tx"),
  conn: document.querySelector("#stat-conn"),
};

let scenarioId = scenarios[0].id;
let stepIndex = 0;
let playing = false;
let timer = 0;

const ACID = [
  ["A", "원자성"],
  ["C", "일관성"],
  ["I", "격리"],
  ["D", "지속성"],
];

function scenario() {
  return scenarios.find((item) => item.id === scenarioId);
}

function renderScenarioButtons() {
  const groups = [];
  scenarioList.innerHTML = "";
  scenarios.forEach((item) => {
    if (!groups.includes(item.group)) {
      groups.push(item.group);
      const label = document.createElement("p");
      label.className = "group-label";
      label.textContent = item.group;
      scenarioList.appendChild(label);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `scenario-btn${item.id === scenarioId ? " is-on" : ""}`;
    btn.innerHTML = `<span class="tag ${item.tone}">${item.tag}</span>${item.title}<small>${item.blurb}</small>`;
    btn.addEventListener("click", () => selectScenario(item.id));
    if (item.id === scenarioId) {
      queueMicrotask(() => btn.scrollIntoView({ block: "nearest" }));
    }
    scenarioList.appendChild(btn);
  });
}

function renderStepButtons() {
  const steps = scenario().steps;
  stepList.innerHTML = "";
  steps.forEach((step, index) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const cls = index === stepIndex ? "is-now" : index < stepIndex ? "is-done" : "";
    btn.className = cls;
    btn.innerHTML = `<b>${index + 1}</b><span>${step.title}</span>`;
    btn.addEventListener("click", () => go(index, true));
    if (index === stepIndex) {
      queueMicrotask(() => btn.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
    li.appendChild(btn);
    stepList.appendChild(li);
  });
}

const defaultStats = [
  ["확정 재고", "이미 반영된 books.stock"],
  ["이 요청이 보는 재고", ""],
  ["주문", "orders 테이블"],
  ["트랜잭션", ""],
];

function paintCell(cell, label, value, note, tone) {
  cell.className = "cell";
  cell.querySelector("span").textContent = label;
  cell.querySelector("strong").textContent = value;
  cell.querySelector("small").textContent = note;
  if (tone === "hot") cell.classList.add("is-hot");
  if (tone === "bad") cell.classList.add("is-bad");
  if (tone === "good") cell.classList.add("is-good");
}

function paintBoard(step) {
  const cells = [...document.querySelectorAll(".board .cell")];
  if (step.stats) {
    step.stats.forEach((stat, index) => {
      paintCell(cells[index], stat.label, stat.value, stat.note, stat.tone);
    });
    return;
  }
  const diverged = step.viewStock !== step.committedStock || step.pendingOrders > 0;
  const orderValue = step.pendingOrders > 0 ? `임시 ${step.pendingOrders}건` : `${step.committedOrders}건`;
  const orderNote = step.pendingOrders > 0 ? `확정 주문 ${step.committedOrders}건` : "orders 테이블";
  paintCell(cells[0], defaultStats[0][0], String(step.committedStock), defaultStats[0][1], step.tone === "ok" ? "good" : "");
  paintCell(cells[1], defaultStats[1][0], String(step.viewStock), diverged ? "커밋 전에는 밖과 다를 수 있음" : "확정값과 같음", diverged ? "hot" : "");
  paintCell(cells[2], defaultStats[2][0], orderValue, orderNote, step.tone === "danger" ? "bad" : "");
  paintCell(cells[3], defaultStats[3][0], step.tx, step.connection, "");
}

function renderStep() {
  const current = scenario();
  const step = current.steps[stepIndex];
  els.kicker.textContent = `${stepIndex + 1} / ${current.steps.length} · ${current.title}`;
  els.title.textContent = step.title;
  els.plain.hidden = !step.plain;
  els.plain.textContent = step.plain || "";
  els.body.textContent = step.body;
  if (stepIndex === 0) els.codeFold.open = false;
  els.code.textContent = step.code;
  const callText = queries[current.id]?.[stepIndex] || "-- 이 단계에서는 나가는 호출이 없습니다.";
  els.sql.textContent = callText;
  els.sqlLabel.textContent = /^\s*(GET|POST|PUT|PATCH|DELETE)\b/m.test(callText)
    ? "이 단계의 외부 호출"
    : "이 단계의 SQL";
  const found = termsIn([step.title, step.plain, step.body, step.callout, step.code, callText].filter(Boolean).join("\n"));
  els.termBox.hidden = found.length === 0;
  els.termList.innerHTML = found.map((item) => `
    <details class="term">
      <summary>${item.word}</summary>
      <p>${item.text}</p>
    </details>
  `).join("");
  const external = current.id.startsWith("ext-");
  const focus = compareFocus[current.id];
  els.compareSummary.textContent = external
    ? "장애가 나도 같이 안 죽는 순서"
    : "전체 쿼리 세 개를 나란히";
  els.compareNote.textContent = external
    ? "카드사는 우리가 고칠 수 없습니다. 기다리지 않고, 잠깐이면 같은 결제 키로 다시 시도하고, 계속되면 호출을 끊고, 끊긴 동안은 결제 성공으로 저장하지 않습니다."
    : "노란 테두리가 이 시나리오가 끝났을 때의 SQL입니다. 문장 순서만 봐도 결과가 왜 다른지 보입니다.";
  els.compare.innerHTML = external
    ? [
        ["1. 타임아웃", "카드사 응답을 무한히 기다리지 않습니다."],
        ["2. 연결 분리", "카드사 호출이 막혀도 상품 조회용 우리 DB는 남습니다."],
        ["3. 재시도", "잠깐 오류만, 같은 결제 키로, 횟수를 제한합니다."],
        ["4. 회로 차단", "계속 실패하면 승인 요청 자체를 멈춥니다."],
        ["5. 폴백", "승인된 척하지 않고, 잠시 후 다시 시도하라고 알립니다."],
      ].map(([title, text]) => `
        <article>
          <h3>${title}</h3>
          <p>${text}</p>
        </article>
      `).join("")
    : compareScripts.map((item) => `
    <article class="${item.id === focus ? "is-on" : ""}">
      <h3>${item.title}</h3>
      <p>끝나면 ${item.result}</p>
      <pre>${item.sql.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
    </article>
  `).join("");
  els.caption.textContent = `${step.name} · ${step.sub}`;
  if (step.callout) {
    els.callout.hidden = false;
    els.callout.textContent = step.callout;
    els.callout.className = `callout${step.tone === "danger" ? " is-danger" : ""}`;
  } else {
    els.callout.hidden = true;
  }
  els.acid.innerHTML = ACID.map(([key, name]) => {
    const on = step.acid.includes(key) ? " on" : "";
    return `<i class="${on}" title="${name}">${key}</i>`;
  }).join("");
  els.prev.disabled = stepIndex === 0;
  els.next.disabled = stepIndex === current.steps.length - 1;
  paintBoard(step);
  renderStepButtons();
  stage.focus(stepIndex, step.tone, step.echoBack);
}

function go(index, pause) {
  const steps = scenario().steps;
  stepIndex = Math.max(0, Math.min(steps.length - 1, index));
  if (pause) stopPlay();
  renderStep();
}

function selectScenario(id) {
  scenarioId = id;
  stepIndex = 0;
  stopPlay();
  stage.setScenario(scenario().steps);
  renderScenarioButtons();
  renderStep();
}

function stopPlay() {
  playing = false;
  window.clearTimeout(timer);
  els.play.textContent = "자동 재생";
}

function playFromHere() {
  playing = true;
  els.play.textContent = "일시정지";
  const tick = () => {
    if (!playing) return;
    const last = scenario().steps.length - 1;
    if (stepIndex >= last) {
      stopPlay();
      return;
    }
    go(stepIndex + 1, false);
    timer = window.setTimeout(tick, 2800);
  };
  timer = window.setTimeout(tick, 2800);
}

els.prev.addEventListener("click", () => go(stepIndex - 1, true));
els.next.addEventListener("click", () => go(stepIndex + 1, true));
els.play.addEventListener("click", () => {
  if (playing) stopPlay();
  else {
    if (stepIndex === scenario().steps.length - 1) go(0, false);
    playFromHere();
  }
});
els.reset.addEventListener("click", () => stage.resetView());

stage.setOnPick((index) => go(index, true));

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowRight") go(stepIndex + 1, true);
  if (event.key === "ArrowLeft") go(stepIndex - 1, true);
  if (event.key === " ") {
    event.preventDefault();
    els.play.click();
  }
});

selectScenario(scenarios[0].id);
