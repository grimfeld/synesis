// Every word on the landing page, in each language the app speaks. The
// French dictionary is typed against the English one, so a missing string
// fails the build. Terms are the app's own (CONTEXT.md, src/i18n).
import type { PlatformId } from "../lib/release";

export const en = {
  lang: "en",
  locale: "en_US",
  meta: {
    title: "Synesis: Bible study notes that link themselves",
    description:
      "A free, open-source notebook for Bible study. Type a scripture and it becomes a link. Plain markdown files on your own devices, which Obsidian opens too.",
  },
  skip: "Skip to content",
  nav: { features: "Features", faq: "Questions", other: "Français", otherLabel: "Lire en français" },
  demoUrl: "https://synesis-beta.vercel.app/",
  hero: {
    eyebrow: "Free and open source",
    title: "Your Bible study, all connected.",
    body: "Synesis is a notebook for personal study, meeting preparation and talks. Type “Rom 12:2” and it becomes a link. Every verse, book, person and place gathers what you have written about it.",
    try: "Try it in your browser",
    platforms: "Windows, macOS, Linux, Android",
    tryNote: "The browser demo opens a sample notebook. Nothing you write there is kept.",
    shotAlt:
      "Synesis showing a talk called “Talk on endurance”: scripture references like Jas 1:2 and Heb 12:1-3 underlined as links, a quoted clipping, and a side panel of candidate material.",
  },
  sections: {
    passages: {
      kicker: "Scripture",
      title: "Write the reference. Synesis makes the link.",
      body: "Type “Ps 23:4”, “Jean 3,16” or “1 Co 13:4-7” the way you always do. Synesis recognises the reference as you type, in English and French, and links it to that verse. Point at it to see everywhere else you have used it.",
      alt: "A note on Psalm 23 with references underlined, and a card listing the other notes that mention Psalm 23.",
    },
    hubs: {
      kicker: "Pages for everything",
      title: "Every verse, book and person has a page.",
      body: "Each Book, Chapter and Verse, and every Place, Character, Concept and Event you write about, gets a page that gathers every note that mentions it, in Bible order. The page for Romans even shows which chapters you study most.",
      alt: "The page for the book of Romans: a strip of its sixteen chapters shaded by how often each is mentioned, and the notes that mention Romans.",
    },
    talks: {
      kicker: "Meetings and talks",
      title: "From research to the platform.",
      body: "Keep quotations from your reading as Clippings, each with its Source. Start a Composition and Synesis offers the material that shares its Tags and Passages. Arrange your outline on a Board, then give the talk from a clean view with a timer.",
      alt: "The Board of a talk: cards for the opening, the body and the close, joined by arrows, with candidate material in a drawer on the right.",
    },
    whole: {
      kicker: "The big picture",
      title: "See how it all fits together.",
      body: "Place people and events on a Timeline of Bible history, follow a journey across a Map of the Bible world, and watch your notes connect in the Graph.",
      timeline: "Timeline",
      timelineAlt: "A timeline of Bible history from Adam to John, with events and people placed by date.",
      map: "Map",
      mapAlt: "A map of the eastern Mediterranean with places like Corinth, Ephesus, Antioch and Mount Sinai.",
      graph: "Graph",
      graphAlt: "A graph of notes, books, people and places joined by the links between them.",
    },
    yours: {
      kicker: "Yours",
      title: "Your notes stay yours.",
      points: [
        { title: "Plain files", body: "Every note is a markdown file in a folder you choose. Obsidian opens it as it is, and so does any text editor." },
        { title: "No account, no cloud", body: "Nothing is sent to a server. Synesis works offline, on your own devices." },
        { title: "Your devices, paired", body: "Scan a code with your phone and your notes stay in step between your own devices, encrypted from one to the other." },
        { title: "Free, for good", body: "Open source under the GNU AGPL. No paid version, no subscription, no advertising, no tracking." },
      ],
      fileCaption: "A note, as it sits in your folder",
    },
  },
  download: {
    kicker: "Get Synesis",
    titleOpen: "Download Synesis",
    titleClosed: "Downloads open with version 0.1",
    bodyOpen: "Free for every platform. Your notes stay in a folder you choose.",
    bodyClosed: (v: string) =>
      `Synesis is still being built${v ? ` (version ${v})` : ""}. Until 0.1 is ready, you can try it in your browser.`,
    coming: "Coming with 0.1",
    later: "Coming later",
    get: "Download",
    yours: "For this device",
    names: { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iPhone and iPad" } satisfies Record<PlatformId, string>,
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "Is it free?",
        a: "Yes, and it will stay free. Synesis is open source under the GNU AGPL. There is no paid version, no subscription and no advertising.",
      },
      {
        q: "Which Bible translation does it use?",
        a: "None is included. Synesis knows the structure of the Bible (66 books, their chapters and verses) and turns references into links. Read your Bible alongside it, in whatever translation and format you like. References are recognised in English and French.",
      },
      {
        q: "Does it need the internet?",
        a: "No. Everything works offline. The internet is only used to show the Map in more detail up close, to fetch the title of a link you clip, and to help your own devices find each other when they sync. Those connections are encrypted, and nothing is stored on a server.",
      },
      {
        q: "Does it work with Obsidian?",
        a: "Yes. Your notes are ordinary markdown files in a folder. Open the same folder in Obsidian and everything is there. Synesis adds no special syntax to your files.",
      },
      {
        q: "What does it know about me?",
        a: "Nothing. The app sends nothing anywhere; your notes only travel between your own paired devices. This website counts visits anonymously, without cookies.",
      },
    ],
  },
  footer: {
    licence: "Synesis is free software under the GNU AGPL-3.0.",
    source: "Source code",
    signing: "Code signing policy",
    privacy: "Privacy",
    version: (v: string) => `Version ${v}`,
  },
};

export type Strings = typeof en;

export const fr: Strings = {
  lang: "fr",
  locale: "fr_FR",
  meta: {
    title: "Synesis : des notes d’étude biblique qui se relient d’elles-mêmes",
    description:
      "Un carnet d’étude biblique gratuit et open source. Tapez une référence, elle devient un lien. De simples fichiers markdown sur vos propres appareils, qu’Obsidian ouvre aussi.",
  },
  skip: "Aller au contenu",
  nav: { features: "Fonctions", faq: "Questions", other: "English", otherLabel: "Read in English" },
  demoUrl: "https://synesis-beta.vercel.app/",
  hero: {
    eyebrow: "Gratuit et open source",
    title: "Toute votre étude biblique, reliée.",
    body: "Synesis est un carnet pour l’étude personnelle, la préparation des réunions et les discours. Tapez « Rm 12:2 » et la référence devient un lien. Chaque verset, livre, personnage et lieu rassemble tout ce que vous avez écrit à son sujet.",
    try: "Essayer dans le navigateur",
    platforms: "Windows, macOS, Linux, Android",
    tryNote: "La démo ouvre un carnet d’exemple dans le navigateur. Rien de ce que vous y écrivez n’est conservé.",
    shotAlt:
      "Synesis affichant un discours intitulé « Talk on endurance » : des références comme Jc 1:2 et Hé 12:1-3 soulignées comme des liens, un extrait cité et un panneau latéral de matière candidate.",
  },
  sections: {
    passages: {
      kicker: "Les Écritures",
      title: "Écrivez la référence. Synesis crée le lien.",
      body: "Tapez « Ps 23:4 », « Jean 3,16 » ou « 1 Co 13:4-7 » comme d’habitude. Synesis reconnaît la référence pendant que vous tapez, en français et en anglais, et la relie à ce verset. Survolez-la pour voir partout où vous l’avez déjà citée.",
      alt: "Une note sur le Psaume 23 avec des références soulignées, et une carte listant les autres notes qui mentionnent le Psaume 23.",
    },
    hubs: {
      kicker: "Une page pour chaque chose",
      title: "Chaque verset, livre et personnage a sa page.",
      body: "Chaque Livre, Chapitre et Verset, et chaque Lieu, Personnage, Concept et Événement dont vous parlez, a une page qui rassemble toutes les notes qui le mentionnent, dans l’ordre biblique. La page de Romains montre même les chapitres que vous étudiez le plus.",
      alt: "La page du livre de Romains : une bande de ses seize chapitres, plus ou moins foncés selon leurs mentions, et les notes qui mentionnent Romains.",
    },
    talks: {
      kicker: "Réunions et discours",
      title: "De la recherche à l’estrade.",
      body: "Gardez les citations de vos lectures comme Extraits, chacun avec sa Source. Commencez une Composition et Synesis vous propose la matière qui partage ses étiquettes et ses Passages. Organisez votre plan sur un Tableau, puis présentez le discours depuis une vue épurée, avec minuteur.",
      alt: "Le Tableau d’un discours : des cartes pour l’introduction, le développement et la conclusion, reliées par des flèches, avec la matière candidate dans un tiroir à droite.",
    },
    whole: {
      kicker: "Vue d’ensemble",
      title: "Voyez comment tout s’assemble.",
      body: "Placez personnages et événements sur une Chronologie de l’histoire biblique, suivez un voyage sur une Carte du monde biblique, et regardez vos notes se relier dans le Graphe.",
      timeline: "Chronologie",
      timelineAlt: "Une chronologie de l’histoire biblique d’Adam à Jean, avec événements et personnages placés selon leur date.",
      map: "Carte",
      mapAlt: "Une carte de la Méditerranée orientale avec des lieux comme Corinthe, Éphèse, Antioche et le mont Sinaï.",
      graph: "Graphe",
      graphAlt: "Un graphe de notes, de livres, de personnages et de lieux reliés par leurs liens.",
    },
    yours: {
      kicker: "À vous",
      title: "Vos notes restent les vôtres.",
      points: [
        { title: "De simples fichiers", body: "Chaque note est un fichier markdown dans le dossier de votre choix. Obsidian l’ouvre tel quel, comme n’importe quel éditeur de texte." },
        { title: "Ni compte ni nuage", body: "Rien n’est envoyé à un serveur. Synesis fonctionne hors ligne, sur vos propres appareils." },
        { title: "Vos appareils, jumelés", body: "Scannez un code avec votre téléphone et vos notes restent à jour entre vos appareils, chiffrées de l’un à l’autre." },
        { title: "Gratuit, pour de bon", body: "Open source sous licence GNU AGPL. Pas de version payante, pas d’abonnement, pas de publicité, pas de pistage." },
      ],
      fileCaption: "Une note, telle qu’elle est dans votre dossier",
    },
  },
  download: {
    kicker: "Obtenir Synesis",
    titleOpen: "Télécharger Synesis",
    titleClosed: "Les téléchargements ouvrent avec la version 0.1",
    bodyOpen: "Gratuit sur toutes les plateformes. Vos notes restent dans le dossier de votre choix.",
    bodyClosed: (v: string) =>
      `Synesis est encore en construction${v ? ` (version ${v})` : ""}. En attendant la 0.1, vous pouvez l’essayer dans votre navigateur.`,
    coming: "Avec la version 0.1",
    later: "Plus tard",
    get: "Télécharger",
    yours: "Pour cet appareil",
    names: { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iPhone et iPad" },
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "Est-ce gratuit ?",
        a: "Oui, et ça le restera. Synesis est open source sous licence GNU AGPL. Il n’y a ni version payante, ni abonnement, ni publicité.",
      },
      {
        q: "Quelle traduction de la Bible utilise-t-il ?",
        a: "Aucune n’est incluse. Synesis connaît la structure de la Bible (66 livres, leurs chapitres et leurs versets) et transforme les références en liens. Lisez votre Bible à côté, dans la traduction et le format de votre choix. Les références sont reconnues en français et en anglais.",
      },
      {
        q: "Faut-il une connexion internet ?",
        a: "Non. Tout fonctionne hors ligne. Internet sert seulement à afficher la Carte plus en détail de près, à récupérer le titre d’un lien que vous gardez comme Extrait, et à aider vos appareils à se trouver quand ils se synchronisent. Ces connexions sont chiffrées et rien n’est stocké sur un serveur.",
      },
      {
        q: "Fonctionne-t-il avec Obsidian ?",
        a: "Oui. Vos notes sont de simples fichiers markdown dans un dossier. Ouvrez le même dossier dans Obsidian et tout y est. Synesis n’ajoute aucune syntaxe particulière à vos fichiers.",
      },
      {
        q: "Que sait-il de moi ?",
        a: "Rien. L’application n’envoie rien nulle part ; vos notes ne voyagent qu’entre vos propres appareils jumelés. Ce site compte les visites de façon anonyme, sans cookies.",
      },
    ],
  },
  footer: {
    licence: "Synesis est un logiciel libre sous licence GNU AGPL-3.0.",
    source: "Code source",
    signing: "Politique de signature du code (code signing policy)",
    privacy: "Confidentialité",
    version: (v: string) => `Version ${v}`,
  },
};

export const strings = { en, fr };
export type Lang = keyof typeof strings;
