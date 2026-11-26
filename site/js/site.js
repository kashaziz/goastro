const root = document.documentElement
const themeButton = document.getElementById('theme-toggle')
const draft = document.getElementById('draft')
const tabs = [...document.querySelectorAll('[role="tab"]')]
const reviewButton = document.getElementById('open-review')
const review = document.getElementById('review')
const status = document.getElementById('editor-status')
const before = document.getElementById('before')
const after = document.getElementById('after')
const source = document.getElementById('source')
const rendered = document.getElementById('rendered-paragraph')
const copyStatus = document.getElementById('copy-status')
let savedText = 'We test a lot of flour. Most of it is fine.'

// Theme: follows the system until the visitor picks one.
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark())
const labelTheme = () => {
  const label = 'Switch to ' + (isDark() ? 'light' : 'dark') + ' mode'
  themeButton.setAttribute('aria-label', label)
  themeButton.title = label
}
labelTheme()
themeButton.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark'
  try { localStorage.setItem('goastro-site-theme', root.dataset.theme) } catch {}
  labelTheme()
})

// Browsers without contenteditable="plaintext-only" (older Firefox): plain editing, and paste as plain text.
if (draft.contentEditable !== 'plaintext-only') {
  draft.contentEditable = 'true'
  draft.addEventListener('paste', (event) => {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
  })
  draft.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault() })
}

function selectTab(target, focus = false) {
  for (const tab of tabs) {
    const active = tab === target
    tab.setAttribute('aria-selected', String(active))
    tab.tabIndex = active ? 0 : -1
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active
  }
  if (focus) target.focus()
}
for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab))
document.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
  const index = tabs.indexOf(event.target)
  if (index === -1) return
  const targets = { ArrowLeft: (index - 1 + tabs.length) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }
  if (!(event.key in targets)) return
  event.preventDefault()
  selectTab(tabs[targets[event.key]], true)
})

const currentDraft = () => draft.innerText.replaceAll(' ', ' ').trim()

function updateDraftViews(saved = false) {
  const current = currentDraft()
  const dirty = current !== savedText
  source.textContent = '# How we choose flour\n\n' + current + '\n\n<Callout type="tip">\n  Use the same recipe when comparing two flours.\n</Callout>'
  rendered.textContent = savedText // Preview shows the saved file, like the real dev server
  reviewButton.disabled = !dirty
  status.textContent = dirty ? 'Unsaved changes' : saved ? 'Saved. Open Preview to see the page.' : 'No unsaved changes'
}

// Word-level diff: only the changed words get the highlighter.
function renderDiff(oldText, newText, beforeEl = before, afterEl = after) {
  const oldWords = oldText.match(/\S+\s*/g) || []
  const newWords = newText.match(/\S+\s*/g) || []
  let first = 0
  let oldEnd = oldWords.length
  let newEnd = newWords.length
  while (first < Math.min(oldEnd, newEnd) && oldWords[first] === newWords[first]) first += 1
  while (oldEnd > first && newEnd > first && oldWords[oldEnd - 1] === newWords[newEnd - 1]) { oldEnd -= 1; newEnd -= 1 }
  const changed = document.createElement('mark')
  changed.textContent = newWords.slice(first, newEnd).join('')
  beforeEl.textContent = oldText || 'Empty paragraph'
  afterEl.replaceChildren(newWords.slice(0, first).join(''), changed, newWords.slice(newEnd).join(''))
  if (!newText) afterEl.textContent = 'Empty paragraph'
}

draft.addEventListener('input', () => updateDraftViews())

// Steps above the demo: show where the visitor is (1 type, 2 review, 3 see the change).
const stepItems = [...document.querySelectorAll('#demo-steps li')]
const setStep = (n) => { for (const li of stepItems) li.classList.toggle('active', Number(li.dataset.step) === n) }
let nudged = false
draft.addEventListener('input', () => {
  const dirty = currentDraft() !== savedText
  setStep(dirty ? 2 : 1)
  if (dirty && !nudged) { nudged = true; reviewButton.classList.add('nudge') }
})

// Walkthrough: a pointer types an edit, clicks Review & save and shows the change, then hands over.
// It plays once when the demo comes into view, and again from "Watch how it works".
// Any click or key in the demo stops it. Visitors who prefer reduced motion get no autoplay.
const demo = document.getElementById('demo')
const cursor = document.getElementById('demo-cursor')
const mini = document.getElementById('mini-review')
const replay = document.getElementById('demo-replay')
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const ORIGINAL = savedText
const START = 'We test a lot of flour.'
const ADDED = ' We bake with each new bag twice.'
const REST = ' Most of it is fine.'
let run = 0 // the current walkthrough; a new number cancels the old one
let playing = false
let autoplayed = false
// Start from the saved file, so the first edit (the visitor's or the walkthrough's) is the only change.
draft.textContent = savedText
updateDraftViews()

const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 300) : ms))
function pointAt(el, dx = 0.5, dy = 0.5) {
  const d = demo.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  cursor.style.transform = `translate(${r.left - d.left + r.width * dx}px, ${r.top - d.top + r.height * dy}px)`
}
function click() {
  cursor.classList.remove('click')
  void cursor.offsetWidth // restart the ripple
  cursor.classList.add('click')
}
function stopWalkthrough(resetText) {
  run += 1
  if (!playing) return
  playing = false
  cursor.classList.remove('show', 'click')
  mini.classList.remove('show')
  reviewButton.classList.remove('pressed')
  if (resetText) { draft.textContent = savedText; updateDraftViews() }
  setStep(1)
}
async function walkthrough() {
  stopWalkthrough(true)
  const id = ++run
  const live = () => id === run
  playing = true
  selectTab(tabs[0])
  savedText = ORIGINAL
  draft.textContent = ORIGINAL
  updateDraftViews()
  setStep(1)
  // Start the pointer near the bottom right corner of the editor.
  pointAt(draft, 1.05, 2.4)
  await sleep(60)
  cursor.classList.add('show')
  await sleep(300)
  if (!live()) return
  pointAt(draft, 0.55, 0.6)
  await sleep(950)
  if (!live()) return
  click()
  await sleep(350)
  for (let i = 1; i <= ADDED.length; i++) {
    if (!live()) return
    draft.textContent = START + ADDED.slice(0, i) + REST
    if (i === 1) updateDraftViews()
    if (!reduced) await sleep(42)
  }
  updateDraftViews()
  setStep(2)
  await sleep(500)
  if (!live()) return
  pointAt(reviewButton, 0.5, 0.6)
  await sleep(1000)
  if (!live()) return
  click()
  reviewButton.classList.add('pressed')
  await sleep(180)
  reviewButton.classList.remove('pressed')
  renderDiff(savedText, currentDraft(), document.getElementById('mini-before'), document.getElementById('mini-after'))
  mini.classList.add('show')
  setStep(3)
  cursor.classList.remove('show')
  await sleep(3800)
  if (!live()) return
  // Hand over: put the text back so the visitor's own edit is the only change.
  mini.classList.remove('show')
  playing = false
  draft.textContent = ORIGINAL
  updateDraftViews()
  setStep(1)
  replay.textContent = '▶ Watch again'
  status.textContent = 'Your turn: click the paragraph and type'
}

// A real click or key in the demo (not on the replay button) stops the walkthrough.
for (const type of ['pointerdown', 'keydown']) {
  demo.addEventListener(type, (event) => {
    if (event.target.closest('#demo-replay')) return
    stopWalkthrough(true)
    autoplayed = true
  }, { capture: true })
}
replay.addEventListener('click', () => walkthrough())
// "See it in the live demo" (How it works section): scroll up to the demo and play the walkthrough.
document.getElementById('watch-demo').addEventListener('click', () => {
  autoplayed = true
  setTimeout(() => walkthrough(), reduced ? 0 : 700)
})

if (!reduced && 'IntersectionObserver' in window) {
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    seen.disconnect()
    if (!autoplayed) { autoplayed = true; setTimeout(() => { if (!playing && currentDraft() === savedText) walkthrough() }, 700) }
  }, { threshold: 0.6 })
  seen.observe(document.querySelector('.editor'))
}

// Phone menu: the nav links open under the header.
const menuButton = document.getElementById('menu-toggle')
const navLinks = document.getElementById('nav-links')
function setMenu(open) {
  navLinks.classList.toggle('open', open)
  menuButton.setAttribute('aria-expanded', String(open))
  menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
  menuButton.firstElementChild.textContent = open ? '✕' : '☰'
}
menuButton.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')))
navLinks.addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false) })
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navLinks.classList.contains('open')) { setMenu(false); menuButton.focus() }
})
document.addEventListener('click', (event) => {
  if (navLinks.classList.contains('open') && !event.target.closest('.nav')) setMenu(false)
})

document.getElementById('try-editor').addEventListener('click', () => {
  stopWalkthrough(true)
  autoplayed = true
  selectTab(tabs[0])
  setTimeout(() => draft.focus({ preventScroll: true }), 450)
})
reviewButton.addEventListener('click', () => {
  reviewButton.classList.remove('nudge')
  renderDiff(savedText, currentDraft())
  setStep(3)
  review.showModal()
})
document.getElementById('keep-editing').addEventListener('click', () => { review.close(); setStep(2) })
document.getElementById('save-preview').addEventListener('click', () => {
  savedText = currentDraft()
  updateDraftViews(true)
  setStep(1)
  review.close()
  selectTab(tabs[0])
  draft.focus({ preventScroll: true })
})

// Enlarge screenshots, with zoom. Steps are a share of the screenshot's real size; "fit" fills the window.
const lightbox = document.getElementById('lightbox')
const lbImg = document.getElementById('lb-img')
const stage = document.getElementById('lb-stage')
const level = document.getElementById('lb-level')
const STEPS = [0.5, 0.75, 1, 1.5, 2]
let zoom = 'fit'
const fitScale = () => Math.min(1, (stage.clientWidth - 32) / lbImg.naturalWidth, (stage.clientHeight - 140) / lbImg.naturalHeight)
function setZoom(next) {
  // Keep the point in the middle of the view in the middle after zooming.
  const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(stage.scrollWidth, 1)
  const cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(stage.scrollHeight, 1)
  zoom = next
  const fit = zoom === 'fit'
  lightbox.classList.toggle('zoomed', !fit)
  lbImg.style.width = fit ? '' : Math.round(lbImg.naturalWidth * zoom) + 'px'
  level.textContent = fit ? 'Fit' : Math.round(zoom * 100) + '%'
  const current = fit ? fitScale() : zoom
  document.getElementById('lb-out').disabled = current <= STEPS[0] + 0.001
  document.getElementById('lb-in').disabled = current >= STEPS[STEPS.length - 1] - 0.001
  document.getElementById('lb-fit').disabled = fit
  requestAnimationFrame(() => stage.scrollTo(cx * stage.scrollWidth - stage.clientWidth / 2, cy * stage.scrollHeight - stage.clientHeight / 2))
}
const step = (dir) => {
  const current = zoom === 'fit' ? fitScale() : zoom
  const next = dir > 0 ? STEPS.find((z) => z > current + 0.001) : [...STEPS].reverse().find((z) => z < current - 0.001)
  if (next) setZoom(next)
}
for (const link of document.querySelectorAll('a.zoom')) {
  link.addEventListener('click', (event) => {
    event.preventDefault()
    const img = link.querySelector('img')
    lbImg.alt = img.alt
    document.getElementById('lb-caption').textContent = link.closest('figure')?.querySelector('figcaption')?.textContent ?? ''
    lightbox.showModal()
    // Small screens open at real size, to read and scroll around in. Large screens fit the window.
    const start = () => { setZoom(innerWidth < 900 ? 1 : 'fit'); stage.scrollTo(0, 0) }
    lbImg.onload = start
    lbImg.src = link.href
    if (lbImg.complete && lbImg.naturalWidth) start()
  })
}
document.getElementById('lb-in').addEventListener('click', () => step(1))
document.getElementById('lb-out').addEventListener('click', () => step(-1))
document.getElementById('lb-fit').addEventListener('click', () => setZoom('fit'))
lbImg.addEventListener('click', () => setZoom(zoom === 'fit' ? 1 : 'fit'))
lightbox.addEventListener('keydown', (event) => {
  if (event.key === '+' || event.key === '=') { event.preventDefault(); step(1) }
  else if (event.key === '-') { event.preventDefault(); step(-1) }
  else if (event.key === '0') { event.preventDefault(); setZoom('fit') }
})
document.getElementById('lb-close').addEventListener('click', () => lightbox.close())
stage.addEventListener('click', (event) => { if (event.target === stage) lightbox.close() })

// Roles: choose one to read what goastro does for it.
const roleButtons = [...document.querySelectorAll('.role')]
for (const button of roleButtons) {
  button.addEventListener('click', () => {
    for (const b of roleButtons) b.setAttribute('aria-pressed', String(b === button))
    for (const text of document.querySelectorAll('.role-text')) text.hidden = text.dataset.role !== button.id
  })
}

// Copy buttons for the two setup commands.
for (const button of document.querySelectorAll('button.copy')) {
  button.addEventListener('click', async () => {
    const command = document.getElementById(button.dataset.copy)
    try {
      await navigator.clipboard.writeText(command.textContent)
      button.textContent = 'Copied'
      copyStatus.textContent = 'Command copied.'
    } catch {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(command)
      if (selection) { selection.removeAllRanges(); selection.addRange(range) }
      button.textContent = 'Selected'
      copyStatus.textContent = 'The command is selected. Use your system copy shortcut.'
    }
    setTimeout(() => (button.textContent = 'Copy'), 2000)
  })
}
