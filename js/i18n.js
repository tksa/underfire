/**
 * Under Fire — i18n.js
 * Lightweight UI translations for the welcome gate + main menu.
 *
 * To add a language: copy the `en` block, translate the values, and add a
 * matching <button class="lang-btn" data-lang="xx"> to the #langBar in index.html.
 * To add a string: give the element data-i18n="someKey" and add that key here.
 * Values may contain HTML (kept simple — <strong>, &amp;, etc.).
 */
(function () {
  const I18N = {
    en: {
      subtitle: "World War II Real-Time Tactics Game",
      tag: "Built by fans &amp; AI vibes",
      b1: "<strong>Free &amp; open:</strong> micro-management &amp; historical accuracy",
      b2: "<strong>Playable today,</strong> early and rough, with plenty still to do.",
      b3: "<strong>Help shape it:</strong> models, scenery, sound, mechanics, history.",
      chip_models: "Models", chip_scenery: "Scenery", chip_textures: "Textures",
      chip_effects: "Effects", chip_sound: "Sound", chip_mechanics: "Mechanics",
      chip_history: "Historical accuracy",
      enter: "Enter &amp; Play ▸",
      build: "Let's Build",
      claude_title: "Improve it with Claude",
      claude_s1: "Fork the repo and open it in <strong>Claude Code</strong>. It loads <strong>CLAUDE.md</strong> and the bundled skills as working context for the whole codebase.",
      claude_s2: "Tell it what you want to add or change. It knows the codebase, finds the right files, and builds it with you.",
      claude_s3: "Get it working, open a pull request, and we take it from there. Solid contributions get merged.",
      foot_license: "Free &amp; non-commercial. Credit <strong>Under Fire</strong>, no ads, no spin-offs.",
      foot_guide: "Contributor guide",
      foot_license_link: "License",
      menu_subtitle: "World War Two RTS",
      m_briefing: "Mission Briefing",
      m_name: "Advance to the Dyle Line",
      m_desc: "Western Front, May 1940. Push your French vanguard through the bocage, seize the village crossroads, and break the German hold on the Dyle. More scenarios are on the way, or build your own.",
      m_side: "Choose Side",
      side_fr: "French", side_de: "German", soon: "soon",
      m_doctrine: "Doctrine",
      doc_inf: "Infantry", doc_inf_d: "+20% HP, +2 sight",
      doc_arm: "Armor", doc_arm_d: "+15% HP, +10% speed",
      doc_sup: "Support", doc_sup_d: "+1 airstrike, +2 mines",
      m_updates: "Latest Updates",
      start: "Start Mission",
      dev_title: "Development Paths",
      dev_1n: "Three.js (now)", dev_1d: "Runs in any browser, zero install. Where we are.",
      dev_2n: "Existing engine", dev_2d: "Port to Unity, Unreal or Godot for scale and tooling.",
      dev_3n: "Custom engine", dev_3d: "Bespoke C++/Rust + WebGPU for massive unit counts.",
      dev_4n: "Neural renderer", dev_4d: "AI image-to-image layer for photorealism on top.",
      dev_ideal: "ideal vision",
      discord: "Join Discord",
    },

    de: {
      subtitle: "Echtzeit-Taktikspiel im Zweiten Weltkrieg",
      tag: "Von Fans &amp; KI gebaut",
      b1: "<strong>Frei &amp; offen:</strong> Mikromanagement &amp; historische Genauigkeit",
      b2: "<strong>Heute spielbar,</strong> früh und roh, mit viel zu tun.",
      b3: "<strong>Gestalte mit:</strong> Modelle, Kulissen, Sound, Mechaniken, Geschichte.",
      chip_models: "Modelle", chip_scenery: "Kulissen", chip_textures: "Texturen",
      chip_effects: "Effekte", chip_sound: "Sound", chip_mechanics: "Mechanik",
      chip_history: "Historische Genauigkeit",
      enter: "Spielen ▸",
      build: "Mitbauen",
      claude_title: "Mit Claude verbessern",
      claude_s1: "Forke das Repo und öffne es in <strong>Claude Code</strong>. Es lädt <strong>CLAUDE.md</strong> und die mitgelieferten Skills als Kontext für die gesamte Codebasis.",
      claude_s2: "Sag, was du hinzufügen oder ändern willst. Claude kennt die Codebasis, findet die richtigen Dateien und baut es mit dir.",
      claude_s3: "Bring es zum Laufen, öffne einen Pull Request, und wir übernehmen. Gute Beiträge werden gemerged.",
      foot_license: "Frei &amp; nicht-kommerziell. Nenne <strong>Under Fire</strong>, keine Werbung, keine Ableger.",
      foot_guide: "Mitwirken-Leitfaden",
      foot_license_link: "Lizenz",
      menu_subtitle: "Zweiter Weltkrieg RTS",
      m_briefing: "Einsatzbesprechung",
      m_name: "Vorstoß zur Dyle-Linie",
      m_desc: "Westfront, Mai 1940. Führe deine französische Vorhut durch die Bocage, nimm die Dorfkreuzung ein und brich den deutschen Halt an der Dyle. Weitere Szenarien folgen, oder baue dein eigenes.",
      m_side: "Seite wählen",
      side_fr: "Franzosen", side_de: "Deutsche", soon: "bald",
      m_doctrine: "Doktrin",
      doc_inf: "Infanterie", doc_inf_d: "+20% LP, +2 Sicht",
      doc_arm: "Panzer", doc_arm_d: "+15% LP, +10% Tempo",
      doc_sup: "Unterstützung", doc_sup_d: "+1 Luftschlag, +2 Minen",
      m_updates: "Neueste Updates",
      start: "Einsatz starten",
      dev_title: "Entwicklungswege",
      dev_1n: "Three.js (jetzt)", dev_1d: "Läuft im Browser, ohne Installation. Hier stehen wir.",
      dev_2n: "Bestehende Engine", dev_2d: "Portierung zu Unity, Unreal oder Godot für Umfang und Tools.",
      dev_3n: "Eigene Engine", dev_3d: "Eigenbau in C++/Rust + WebGPU für riesige Einheitenzahlen.",
      dev_4n: "Neuronaler Renderer", dev_4d: "KI-Bild-zu-Bild-Schicht für Fotorealismus obendrauf.",
      dev_ideal: "Idealvision",
      discord: "Discord beitreten",
    },

    pl: {
      subtitle: "Taktyczna gra czasu rzeczywistego z II wojny światowej",
      tag: "Tworzone przez fanów &amp; AI",
      b1: "<strong>Wolne i otwarte:</strong> mikrozarządzanie i dokładność historyczna",
      b2: "<strong>Grywalne dziś,</strong> wczesne i surowe, wiele do zrobienia.",
      b3: "<strong>Współtwórz:</strong> modele, sceneria, dźwięk, mechanika, historia.",
      chip_models: "Modele", chip_scenery: "Sceneria", chip_textures: "Tekstury",
      chip_effects: "Efekty", chip_sound: "Dźwięk", chip_mechanics: "Mechanika",
      chip_history: "Dokładność historyczna",
      enter: "Graj ▸",
      build: "Twórzmy",
      claude_title: "Ulepsz z Claude",
      claude_s1: "Sforkuj repo i otwórz w <strong>Claude Code</strong>. Wczyta <strong>CLAUDE.md</strong> i wbudowane umiejętności jako kontekst całej bazy kodu.",
      claude_s2: "Powiedz, co chcesz dodać lub zmienić. Claude zna kod, znajdzie właściwe pliki i zbuduje to z tobą.",
      claude_s3: "Spraw, by działało, otwórz pull request, a my zajmiemy się resztą. Dobre wkłady są scalane.",
      foot_license: "Wolne &amp; niekomercyjne. Podaj <strong>Under Fire</strong>, bez reklam, bez odsprzedaży.",
      foot_guide: "Przewodnik dla współtwórców",
      foot_license_link: "Licencja",
      menu_subtitle: "RTS z II wojny światowej",
      m_briefing: "Odprawa misji",
      m_name: "Natarcie na linię Dyle",
      m_desc: "Front zachodni, maj 1940. Poprowadź francuską straż przednią przez bocage, zajmij wiejskie skrzyżowanie i przełam niemiecką obronę na Dyle. Więcej scenariuszy w drodze, albo stwórz własny.",
      m_side: "Wybierz stronę",
      side_fr: "Francuzi", side_de: "Niemcy", soon: "wkrótce",
      m_doctrine: "Doktryna",
      doc_inf: "Piechota", doc_inf_d: "+20% PŻ, +2 zasięg wzroku",
      doc_arm: "Pancerne", doc_arm_d: "+15% PŻ, +10% prędkości",
      doc_sup: "Wsparcie", doc_sup_d: "+1 nalot, +2 miny",
      m_updates: "Najnowsze zmiany",
      start: "Rozpocznij misję",
      dev_title: "Ścieżki rozwoju",
      dev_1n: "Three.js (teraz)", dev_1d: "Działa w przeglądarce, bez instalacji. Tu jesteśmy.",
      dev_2n: "Istniejący silnik", dev_2d: "Port do Unity, Unreal lub Godot dla skali i narzędzi.",
      dev_3n: "Własny silnik", dev_3d: "Autorski C++/Rust + WebGPU dla ogromnej liczby jednostek.",
      dev_4n: "Renderer neuronowy", dev_4d: "Warstwa AI obraz-do-obrazu dla fotorealizmu.",
      dev_ideal: "idealna wizja",
      discord: "Dołącz do Discorda",
    },

    fr: {
      subtitle: "Jeu de tactique en temps réel de la Seconde Guerre mondiale",
      tag: "Créé par des fans &amp; l'IA",
      b1: "<strong>Libre &amp; ouvert :</strong> micro-gestion &amp; précision historique",
      b2: "<strong>Jouable aujourd'hui,</strong> brut et précoce, avec beaucoup à faire.",
      b3: "<strong>Participez :</strong> modèles, décors, son, mécaniques, histoire.",
      chip_models: "Modèles", chip_scenery: "Décors", chip_textures: "Textures",
      chip_effects: "Effets", chip_sound: "Son", chip_mechanics: "Mécaniques",
      chip_history: "Précision historique",
      enter: "Jouer ▸",
      build: "Construisons",
      claude_title: "Améliorez-le avec Claude",
      claude_s1: "Forkez le dépôt et ouvrez-le dans <strong>Claude Code</strong>. Il charge <strong>CLAUDE.md</strong> et les skills inclus comme contexte de tout le code.",
      claude_s2: "Dites ce que vous voulez ajouter ou changer. Claude connaît le code, trouve les bons fichiers et le construit avec vous.",
      claude_s3: "Faites-le fonctionner, ouvrez une pull request, et on s'occupe du reste. Les bonnes contributions sont fusionnées.",
      foot_license: "Libre &amp; non commercial. Créditez <strong>Under Fire</strong>, pas de pub, pas de dérivés.",
      foot_guide: "Guide du contributeur",
      foot_license_link: "Licence",
      menu_subtitle: "RTS de la Seconde Guerre mondiale",
      m_briefing: "Briefing de mission",
      m_name: "Avance vers la ligne Dyle",
      m_desc: "Front de l'Ouest, mai 1940. Menez votre avant-garde française à travers le bocage, prenez le carrefour du village et brisez la tenue allemande sur la Dyle. D'autres scénarios arrivent, ou créez le vôtre.",
      m_side: "Choisir un camp",
      side_fr: "Français", side_de: "Allemands", soon: "bientôt",
      m_doctrine: "Doctrine",
      doc_inf: "Infanterie", doc_inf_d: "+20% PV, +2 vue",
      doc_arm: "Blindés", doc_arm_d: "+15% PV, +10% vitesse",
      doc_sup: "Soutien", doc_sup_d: "+1 frappe aérienne, +2 mines",
      m_updates: "Dernières mises à jour",
      start: "Démarrer la mission",
      dev_title: "Voies de développement",
      dev_1n: "Three.js (maintenant)", dev_1d: "Tourne dans le navigateur, sans installation. Notre point actuel.",
      dev_2n: "Moteur existant", dev_2d: "Portage vers Unity, Unreal ou Godot pour l'échelle et les outils.",
      dev_3n: "Moteur sur mesure", dev_3d: "C++/Rust + WebGPU sur mesure pour de très nombreuses unités.",
      dev_4n: "Rendu neuronal", dev_4d: "Couche IA image-à-image pour le photoréalisme.",
      dev_ideal: "vision idéale",
      discord: "Rejoindre le Discord",
    },

    es: {
      subtitle: "Juego de táctica en tiempo real de la Segunda Guerra Mundial",
      tag: "Creado por fans e IA",
      b1: "<strong>Libre y abierto:</strong> microgestión y precisión histórica",
      b2: "<strong>Jugable hoy,</strong> temprano y rudo, con mucho por hacer.",
      b3: "<strong>Da forma:</strong> modelos, escenarios, sonido, mecánicas, historia.",
      chip_models: "Modelos", chip_scenery: "Escenarios", chip_textures: "Texturas",
      chip_effects: "Efectos", chip_sound: "Sonido", chip_mechanics: "Mecánicas",
      chip_history: "Precisión histórica",
      enter: "Jugar ▸",
      build: "A construir",
      claude_title: "Mejóralo con Claude",
      claude_s1: "Haz un fork del repo y ábrelo en <strong>Claude Code</strong>. Carga <strong>CLAUDE.md</strong> y las skills incluidas como contexto de todo el código.",
      claude_s2: "Dile qué quieres añadir o cambiar. Claude conoce el código, encuentra los archivos correctos y lo construye contigo.",
      claude_s3: "Haz que funcione, abre un pull request y nosotros seguimos. Las buenas contribuciones se fusionan.",
      foot_license: "Libre y no comercial. Acredita a <strong>Under Fire</strong>, sin anuncios, sin derivados.",
      foot_guide: "Guía de contribución",
      foot_license_link: "Licencia",
      menu_subtitle: "RTS de la Segunda Guerra Mundial",
      m_briefing: "Informe de misión",
      m_name: "Avance hacia la línea Dyle",
      m_desc: "Frente Occidental, mayo de 1940. Lleva a tu vanguardia francesa por el bocage, toma el cruce del pueblo y rompe el control alemán sobre el Dyle. Llegan más escenarios, o crea el tuyo.",
      m_side: "Elige bando",
      side_fr: "Franceses", side_de: "Alemanes", soon: "pronto",
      m_doctrine: "Doctrina",
      doc_inf: "Infantería", doc_inf_d: "+20% PV, +2 visión",
      doc_arm: "Blindados", doc_arm_d: "+15% PV, +10% velocidad",
      doc_sup: "Apoyo", doc_sup_d: "+1 ataque aéreo, +2 minas",
      m_updates: "Novedades",
      start: "Iniciar misión",
      dev_title: "Rutas de desarrollo",
      dev_1n: "Three.js (ahora)", dev_1d: "Funciona en el navegador, sin instalación. Aquí estamos.",
      dev_2n: "Motor existente", dev_2d: "Portar a Unity, Unreal o Godot para escala y herramientas.",
      dev_3n: "Motor propio", dev_3d: "C++/Rust + WebGPU a medida para muchísimas unidades.",
      dev_4n: "Renderizador neuronal", dev_4d: "Capa de IA imagen-a-imagen para fotorrealismo.",
      dev_ideal: "visión ideal",
      discord: "Unirse a Discord",
    },
  };

  const DEFAULT = 'en';
  const getSaved = () => { try { return localStorage.getItem('under_lang'); } catch (e) { return null; } };
  const save = (l) => { try { localStorage.setItem('under_lang', l); } catch (e) { } };

  function apply(lang) {
    const dict = I18N[lang] || I18N[DEFAULT];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const v = (dict[k] != null) ? dict[k] : I18N[DEFAULT][k];
      if (v != null) el.innerHTML = v;
    });
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    save(lang);
    if (window.Game) window.Game.lang = lang;
  }

  function init() {
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.addEventListener('click', () => apply(b.dataset.lang));
    });
    apply(getSaved() || DEFAULT);
  }

  // Expose for other code (and re-applying after dynamic content changes)
  window.UnderI18N = { dict: I18N, apply, default: DEFAULT };
  if (window.Game) window.Game.applyLanguage = apply;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
