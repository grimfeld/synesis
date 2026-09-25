# Dropbox, OneDrive ou Google Drive sur Linux

OneDrive, Google Drive et Dropbox offrent tous un niveau gratuit (5 Go, 15 Go et 2 Go) et une application de bureau qui reflète un dossier sur chaque ordinateur connecté. Placez le coffre dans ce dossier. Leurs apps mobiles ne reflètent **pas** les dossiers ; cela couvre donc les ordinateurs seulement ; ajoutez Syncthing plus tard si un téléphone s'ajoute.

Seul Dropbox fournit un client Linux officiel. Pour OneDrive et Google Drive, des clients communautaires fonctionnent bien ; si vous préférez les éviter, Syncthing (l'autre onglet) ne demande aucun compte.

1. Installez un client pour votre fournisseur et créez le coffre dans son dossier :
   - **Dropbox** (officiel)
     - Installez depuis [dropbox.com/install-linux](https://www.dropbox.com/install-linux) (deb/rpm) ou le paquet de votre distribution, puis lancez `dropbox start -i` une fois et connectez-vous.
     - Dossier : `~/Dropbox`. Créez le coffre dans `~/Dropbox/Synesis`.
   - **OneDrive** (abraunegg/onedrive)
     - Installez `onedrive` depuis votre distribution ou [github.com/abraunegg/onedrive](https://github.com/abraunegg/onedrive).
     - Lancez `onedrive` une fois pour vous connecter, puis activez le service : `systemctl --user enable --now onedrive`.
     - Dossier : `~/OneDrive`. Créez le coffre dans `~/OneDrive/Synesis`.
   - **Google Drive** (montage rclone ou Comptes en ligne GNOME)
     - GNOME : **Paramètres → Comptes en ligne → Google**, cochez *Fichiers* ; Drive apparaît dans Fichiers. C'est un montage réseau, plus lent et pas toujours disponible hors ligne ; préférez rclone pour un vrai miroir : `rclone config` (Google Drive), puis `rclone bisync gdrive:Synesis ~/GoogleDrive/Synesis` sur minuterie.
     - Créez le coffre dans `~/GoogleDrive/Synesis`.
2. Gardez le coffre sur cet ordinateur : **désactivez** « fichiers à la demande » / « en ligne seulement » pour le dossier du coffre, ou marquez le dossier Synesis *Toujours conserver sur cet appareil*. Synesis lit les fichiers directement ; un espace réservé non téléchargé paraît vide.
3. Essayez une fois : sur cet ordinateur, créez une note avec [Capture rapide](command:create.quick) contenant une ligne comme *test de synchro depuis cet appareil*. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé, puis ouvrez Synesis sur l'autre ordinateur (ou relancez-le) : la note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents. Supprimez ensuite la note de test avec le bouton de suppression de son en-tête.

## À savoir

- N'ouvrez pas le coffre depuis deux ordinateurs avec l'app de bureau **en pause** sur l'un pendant des jours ; la fusion s'en sort, mais plus l'écart est long, plus `.bible-study/sync/` a à rapprocher d'un coup.
- Modifiez la même note sur les deux ordinateurs pendant que l'un est hors ligne, puis reconnectez : les deux modifications survivent. Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. Des fichiers « copie en conflit » peuvent quand même apparaître si deux ordinateurs enregistrent dans la même seconde. Supprimez la copie ; le texte fusionné de Synesis est dans l'original.
- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
