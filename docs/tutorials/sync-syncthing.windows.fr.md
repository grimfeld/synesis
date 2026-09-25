# Syncthing sur Windows

Syncthing copie un dossier directement entre vos propres appareils, chiffré, sans compte ni nuage. Gratuit et open source sur Windows, macOS, Linux et Android (pas iOS). Les appareils se synchronisent dès que deux d'entre eux sont en ligne en même temps ; un appareil qui reste allumé (un ordinateur de bureau, un NAS) accélère les autres.

1. Téléchargez **SyncTrayzor** (Syncthing avec icône de barre d'état et démarrage automatique) depuis [github.com/canton7/SyncTrayzor/releases](https://github.com/canton7/SyncTrayzor/releases), ou Syncthing seul depuis [syncthing.net/downloads](https://syncthing.net/downloads/). Lancez-le. Autorisez-le dans le pare-feu Windows pour les réseaux privés quand on vous le demande ; c'est ce qui permet aux appareils de se trouver sur votre Wi-Fi. Dans SyncTrayzor, cochez **Démarrer à l'ouverture de session** et **Démarrer réduit**.
2. Appairez les appareils. Sur cet appareil, ouvrez l'interface web de Syncthing (elle s'ouvre dans le navigateur ; l'icône de la barre d'état a *Ouvrir*). Sous **Actions → Afficher l'ID**, copiez le long **ID d'appareil**. Sur l'autre appareil, **Ajouter un appareil distant**, collez l'ID, donnez-lui un nom, enregistrez. De retour sur cet appareil, acceptez l'invite *Nouvel appareil* qui apparaît dans l'interface.
3. Partagez le coffre. Sur cet appareil, **Ajouter un partage** : choisissez le dossier du coffre Synesis (déjà présent, ou celui où vous allez créer le coffre), étiquette *Synesis*, et sous **Partage** cochez l'autre appareil. Enregistrez. Sur l'autre appareil, acceptez l'invite *Nouveau partage* et choisissez où le placer (`C:\Users\<vous>\Sync\Synesis` est un bon défaut ; Synesis y regarde). La synchronisation démarre aussitôt.
4. Vérifiez les réglages qui comptent, sur chaque appareil :
   - **Type de partage** : *Envoi et réception*.
   - **Motifs d'exclusion** : aucun. Le dossier caché `.bible-study/` doit aussi se synchroniser.
   - Donnez à chaque appareil un nom lisible ; Synesis l'affiche comme *Synchronisé depuis <nom>*.
5. Essayez une fois : sur cet appareil, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre appareil (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- Le **versionnage** est facultatif. *Échelonné* garde d'anciennes copies dans `.stversions/`, hors de vue de Synesis.
- Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez : les deux modifications survivent. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
