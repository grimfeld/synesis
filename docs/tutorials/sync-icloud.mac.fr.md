# iCloud Drive sur un Mac

Gratuit avec n'importe quel identifiant Apple (5 Go inclus ; un coffre de milliers de notes pèse quelques mégaoctets). Atteint chaque Mac, iPhone et iPad connecté au même identifiant Apple, et Windows via iCloud pour Windows.

1. Ouvrez **Réglages Système → [votre nom] → iCloud → iCloud Drive** et vérifiez qu'iCloud Drive est **activé**.
2. Choisissez où le coffre vit dans iCloud Drive :
   - **Si vous utilisez aussi un iPhone ou un iPad**, le coffre doit être dans le dossier iCloud propre à Synesis, le seul que Synesis peut atteindre sur iOS. Ouvrez une fois Synesis sur l'iPhone avec iCloud activé (son tutoriel iCloud Drive) : le dossier apparaît dans le Finder sous **iCloud Drive → Synesis**, à `~/Library/Mobile Documents/iCloud~tech~grimfeld~synesis/Documents`. Synesis sur ce Mac propose alors ce dossier, et liste un coffre créé là par l'iPhone sous *Synchronisé depuis …*.
   - **Avec des Mac uniquement**, créez un dossier **Synesis** dans iCloud Drive depuis le Finder (`~/Library/Mobile Documents/com~apple~CloudDocs/Synesis`) ; Synesis le propose.
3. Créez le coffre dans ce dossier, ou ouvrez celui listé sous *Synchronisé depuis …*. Sur ce Mac, c'est tout.
4. Ouvrez le coffre sur vos autres appareils Apple :
   - **Autre Mac** : connectez le même identifiant Apple, activez iCloud Drive, lancez Synesis : il trouve le coffre sous *Synchronisé depuis ce Mac* et l'ouvre.
   - **iPhone / iPad** : installez Synesis, choisissez *Utiliser un dossier synchronisé* puis iCloud Drive dans l'assistant ; un coffre dans iCloud Drive → Synesis est proposé.
5. Essayez une fois : sur ce Mac, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre appareil (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- iCloud synchronise fichier par fichier, en général en quelques secondes en Wi-Fi. Le premier envoi peut prendre quelques minutes.
- Avec *Optimiser le stockage du Mac* activé, macOS peut renvoyer dans le nuage les fichiers que vous n'avez pas ouverts depuis un moment. Synesis les garde dans la liste et demande à iCloud de les télécharger ; une note en cours de téléchargement s'ouvre dès qu'elle est arrivée. Désactivez l'option si vous ouvrez aussi le coffre dans Obsidian ou un autre éditeur.
- Un coffre dans `com~apple~CloudDocs/Synesis` est hors de portée d'un iPhone. Pour y ajouter un iPhone, créez un coffre dans iCloud Drive → Synesis et déplacez-y les notes dans le Finder, ou associez plutôt l'iPhone.
- Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez : les deux modifications survivent. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
