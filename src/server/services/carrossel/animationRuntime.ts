/**
 * Animação de entrada dos slides (Web Animations API), controlável quadro a quadro.
 *
 * O mesmo script serve a duas coisas:
 * - prévia no editor (mode "preview"): toca em loop com o relógio real;
 * - exportação em MP4 (mode "export"): não toca sozinho; o Chromium chama window.__anim.build() e depois
 *   window.__anim.seek(ms) para cada quadro, então o resultado é determinístico.
 */
export const ANIMATION_PRESETS: Record<string, string> = {
  "fade-up": "Subir suave",
  "slide-left": "Entrar da esquerda",
  "slide-right": "Entrar da direita",
  "zoom-in": "Zoom de entrada",
  "blur-in": "Foco (desfoque)",
  pop: "Pop",
};

export const PREVIEW_TOTAL_MS = 6000;

const RUNTIME_JS = String.raw`
(function(){
  var cfg = __CFG__;
  var E = 'cubic-bezier(.2,.7,.2,1)';
  var PRESETS = {
    'fade-up':    {kf:[{opacity:0,transform:'translateY(56px)'},{opacity:1,transform:'translateY(0)'}], dur:750, gap:160},
    'slide-left': {kf:[{opacity:0,transform:'translateX(-120px)'},{opacity:1,transform:'translateX(0)'}], dur:700, gap:150},
    'slide-right':{kf:[{opacity:0,transform:'translateX(120px)'},{opacity:1,transform:'translateX(0)'}], dur:700, gap:150},
    'zoom-in':    {kf:[{opacity:0,transform:'scale(.88)'},{opacity:1,transform:'scale(1)'}], dur:700, gap:150},
    'blur-in':    {kf:[{opacity:0,filter:'blur(22px)'},{opacity:1,filter:'blur(0px)'}], dur:800, gap:160},
    'pop':        {kf:[{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'scale(1.06)',offset:.7},{opacity:1,transform:'scale(1)'}], dur:650, gap:140}
  };
  var anims = [];

  function root(){
    return document.querySelector('[data-tpl-root]') || document.querySelector('.slide-wrapper') || document.body.firstElementChild;
  }
  // blocos que entram em sequência: filhos diretos do slide; um contêiner flex sem slot próprio é aberto um nível
  function blocks(){
    var fr = root(), out = [];
    if(!fr) return out;
    [].slice.call(fr.children).forEach(function(c){
      if(c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.tagName === 'LINK' || c.hasAttribute('data-anim-skip')) return;
      var kids = [].slice.call(c.children);
      var plain = !c.hasAttribute('data-slot') && !c.hasAttribute('data-image-slot') && !c.hasAttribute('data-asset');
      if(plain && kids.length > 1 && getComputedStyle(c).display.indexOf('flex') > -1) out.push.apply(out, kids);
      else out.push(c);
    });
    return out;
  }
  function build(totalMs){
    anims.forEach(function(a){ a.cancel(); });
    anims = [];
    var end = 0, p = PRESETS[cfg.preset];
    if(p){
      blocks().forEach(function(el, i){
        var a = el.animate(p.kf, {duration:p.dur, delay:i*p.gap, easing:E, fill:'both'});
        a.pause(); a.currentTime = 0; anims.push(a);
        end = Math.max(end, i*p.gap + p.dur);
      });
    }
    if(cfg.kenBurns){
      [].slice.call(document.querySelectorAll('[data-image-slot] img, [data-image-slot] video, img[data-vframe]')).forEach(function(m){
        if(m.parentNode && m.parentNode.style) m.parentNode.style.overflow = 'hidden';
        var a = m.animate([{transform:'scale(1)'},{transform:'scale(1.12)'}], {duration:Math.max(totalMs||1000, 1000), easing:'linear', fill:'both'});
        a.pause(); a.currentTime = 0; anims.push(a);
      });
    }
    return end;
  }
  function seek(t){ anims.forEach(function(a){ a.currentTime = t; }); }
  window.__anim = {build:build, seek:seek, cfg:cfg};

  if(cfg.autoplay){
    var waited = 0;
    (function start(){
      if(document.documentElement.dataset.fitDone !== '1' && waited < 3000){ waited += 50; return setTimeout(start, 50); }
      var total = cfg.totalMs, t0 = performance.now();
      build(total);
      (function tick(now){
        var t = now - t0;
        if(t > total + 1200){ t0 = now; t = 0; }
        seek(t);
        requestAnimationFrame(tick);
      })(t0);
    })();
  }
})();
`;

export type AnimMode = "preview" | "export";

export interface SlideAnimationLike { preset?: string; ken_burns?: boolean }

export const isActive = (anim?: SlideAnimationLike | null) => !!anim && ((anim.preset ? anim.preset in ANIMATION_PRESETS : false) || !!anim.ken_burns);

/** Acrescenta o runtime de animação ao HTML do slide. */
export function inject(html: string, preset: string, kenBurns: boolean, mode: AnimMode, totalMs = PREVIEW_TOTAL_MS): string {
  const cfg = { preset: preset in ANIMATION_PRESETS ? preset : "none", kenBurns: !!kenBurns, autoplay: mode === "preview", totalMs };
  const script = `<script>${RUNTIME_JS.replace("__CFG__", JSON.stringify(cfg))}</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}\n</body>`) : html + script;
}

/** mode undefined = estático (PNG); "preview" / "export" injetam a animação do slide, se houver. */
export function apply(html: string, anim: SlideAnimationLike | null | undefined, mode?: AnimMode): string {
  if (mode && isActive(anim)) return inject(html, anim!.preset || "none", !!anim!.ken_burns, mode);
  return html;
}
