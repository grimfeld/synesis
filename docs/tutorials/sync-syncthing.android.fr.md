# Syncthing sur Android

Syncthing copie un dossier directement entre vos propres appareils, chiffré, sans compte ni nuage. Gratuit et open source sur Windows, macOS, Linux et Android (pas iOS). Les appareils se synchronisent dès que deux d'entre eux sont en ligne en même temps ; un appareil qui reste allumé (un ordinateur de bureau, un NAS) accélère les autres.

1. Installez **Syncthing-Fork** depuis [F-Droid](https://f-droid.org/packages/com.github.catfriend1.syncthingandroid/) ou Google Play. (L'app Syncthing d'origine a quitté Play en 2024 ; le Fork est maintenu.)

   Ouvrez-le et accordez les permissions demandées : **Accès à tous les fichiers** (pour écrire le dossier du coffre) et **Ignorer l'optimisation de batterie** (pour continuer en arrière-plan). Dans **Paramètres → Conditions d'exécution**, choisissez quand il tourne : *toujours* ou *seulement en Wi-Fi* et *en charge* pour économiser la batterie.
2. Créez d'abord le coffre. Android n'a aucun dossier qu'un outil de synchro surveille d'office : Synesis crée donc le coffre, et c'est vous qui y pointez Syncthing — et non l'inverse.

   Dans Synesis, choisissez *Utiliser un dossier synchronisé*, nommez le coffre et autorisez l'accès aux fichiers quand c'est demandé. L'écran affiche le dossier utilisé, normalement `Documents/Synesis/<nom>`. Touchez **Créer le coffre**, et notez le chemin affiché : les étapes suivantes en ont besoin.
3. Appairez avec l'ordinateur. Dans Syncthing-Fork, touchez **Appareils → +**. Scannez le QR code affiché sur l'ordinateur sous *Actions → Afficher l'ID*, ou collez l'ID. Nommez l'ordinateur. Sur l'ordinateur, acceptez l'invite *Nouvel appareil*.
4. Partagez le coffre. Dans Syncthing-Fork, touchez **Partages → +** et choisissez le dossier indiqué par Synesis (`Documents/Synesis/<nom>`). Donnez-lui un identifiant reconnaissable et partagez-le avec l'ordinateur. Sur l'ordinateur, acceptez l'invite *Nouveau partage* et pointez-la vers le dossier du coffre — le même coffre s'il en a déjà un, sinon un dossier vide. Attendez que le dossier affiche *À jour* des deux côtés.
5. Essayez une fois : sur cet appareil, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre appareil (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez : les deux modifications survivent. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
