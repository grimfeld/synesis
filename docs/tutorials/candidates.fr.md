# Candidats

Un candidat est un document de votre coffre, le plus souvent une Note ou un Extrait, qui partage un tag ou un Passage avec une Composition, ou qui cite une Source sur laquelle elle s'appuie, sans que la Composition le mentionne encore : de la matière que vous pourriez encore utiliser. Les candidats sont rassemblés à côté de la Composition pendant que vous écrivez, pour ne rien oublier d'utile.

1. Ouvrez une de vos Compositions depuis **Compositions en cours** sur l'[Accueil](command:nav.home), où chaque carte compte ses candidats, ou créez-en une avec [Nouvelle Composition](command:create.composition) (son bouton **Supprimer** dans l'en-tête l'enlève). Si elle n'a encore ni tag ni Passage, ajoutez un tag à la fin avec [Insérer un tag](command:editor.tag).
2. Regardez **Matière candidate** dans le panneau de droite (**Afficher / masquer le panneau** dans l'en-tête l'affiche). Chaque candidat indique les tags et Passages qu'il partage avec la Composition. Cliquez sur l'un d'eux pour le lire, puis revenez avec [Retour](command:nav.back).
3. Rattachez une Source sur laquelle vous vous appuyez pour préparer, avec [Ajouter une Source](command:composition.addSource), ou avec **Ajouter une Source** en haut de **Matière candidate** : chaque Extrait et chaque Note qui la citent rejoignent les candidats, marqués de leur provenance (« de *Keep Enduring with Joy* »), même sans tag ni Passage en commun avec la Composition. Elle apparaît comme une pastille au-dessus des candidats, dont le **×** la retire.
4. Essayez une fois : utilisez un candidat. Sur un ordinateur, faites-le glisser depuis **Matière candidate** dans votre texte, là où il a sa place : un Extrait arrive comme une incorporation sur sa propre ligne, tout le reste comme un lien. Ou bien, sur une nouvelle ligne de votre Composition, lancez [Insérer un lien](command:editor.link) et tapez son titre, ou incorporez un Extrait avec [Insérer une incorporation](command:editor.embed). Il quitte **Matière candidate** et passe dans **Utilisé dans cette Composition**.

## À savoir

- Un tag qui nomme le candidat compte aussi comme une mention.
- Placer un candidat sur le **Tableau** de la Composition ne l'utilise pas : il figure sous **Sur le tableau** et reste candidat tant que la Composition elle-même ne le mentionne pas. Le bouton **Placer sur le tableau** à côté de chaque candidat l'y pose comme carte sans quitter le discours.
- Rattacher une Source qui a des parties, comme un livre, amène aussi ce qui cite ses parties (ses chapitres) ; rattacher un seul chapitre n'amène que ce qui cite ce chapitre. Rattacher une Source n'utilise pas ses Extraits : ils restent candidats tant que la Composition ne les mentionne pas. Les Sources sont gardées dans la propriété `sources` de la Composition.
