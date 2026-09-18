# Syncthing sur Android

Syncthing copie un dossier directement entre vos propres appareils, chiffré, sans compte ni nuage. Gratuit et open source sur Windows, macOS, Linux et Android (pas iOS). Les appareils se synchronisent dès que deux d'entre eux sont en ligne en même temps ; un appareil qui reste allumé (un ordinateur de bureau, un NAS) accélère les autres.

## Installation

1. Installez **Syncthing-Fork** depuis [F-Droid](https://f-droid.org/packages/com.github.catfriend1.syncthingandroid/) ou Google Play. (L'app Syncthing d'origine a quitté Play en 2024 ; le Fork est maintenu.)
2. Ouvrez-le et accordez les permissions demandées : **Accès à tous les fichiers** (pour écrire le dossier du coffre) et **Ignorer l'optimisation de batterie** (pour continuer en arrière-plan).
3. Dans **Paramètres → Conditions d'exécution**, choisissez quand il tourne : *toujours* ou *seulement en Wi-Fi* et *en charge* pour économiser la batterie.

## Créez d'abord le coffre

Android n'a aucun dossier qu'un outil de synchro surveille d'office : Synesis crée donc le coffre, et c'est vous qui y pointez Syncthing — et non l'inverse.

1. Dans Synesis, choisissez *Utiliser un dossier synchronisé*, nommez le coffre et autorisez l'accès aux fichiers quand c'est demandé. L'écran affiche le dossier utilisé, normalement `Documents/Synesis/<nom>`.
2. Touchez **Créer le coffre**. Notez le chemin affiché : les étapes suivantes en ont besoin.

## Appairer avec l'ordinateur

1. Dans Syncthing-Fork, touchez **Appareils → +**. Scannez le QR code affiché sur l'ordinateur sous *Actions → Afficher l'ID*, ou collez l'ID. Nommez l'ordinateur.
2. Sur l'ordinateur, acceptez l'invite *Nouvel appareil*.
3. Dans Syncthing-Fork, touchez **Partages → +** et choisissez le dossier indiqué par Synesis (`Documents/Synesis/<nom>`). Donnez-lui un identifiant reconnaissable et partagez-le avec l'ordinateur.
4. Sur l'ordinateur, acceptez l'invite *Nouveau partage* et pointez-la vers le dossier du coffre — le même coffre s'il en a déjà un, sinon un dossier vide.
5. Attendez que le dossier affiche *À jour* des deux côtés.


## Vérifier que ça marche

1. Sur cet appareil, créez une note (Capture rapide, `Ctrl/⌘ ⇧ N`) avec une ligne comme *test de synchro depuis cet appareil*.
2. Attendez que l'icône de l'outil de synchro indique que l'envoi est terminé.
3. Sur l'autre appareil, ouvrez Synesis (ou relancez-le). La note apparaît dans la barre latérale sous Notes, et l'Accueil la liste dans Récents.
4. Modifiez la même note sur les deux appareils pendant que l'un est hors ligne, puis reconnectez. Les deux modifications survivent : Synesis garde un journal de changements par appareil dans `.bible-study/sync/` et les fusionne ; l'outil de synchro n'a jamais de conflit à résoudre. S'il crée quand même un fichier « copie en conflit », supprimez cette copie : le texte fusionné est déjà dans le fichier d'origine.

## Bon à savoir

- Tout le dossier du coffre est synchronisé, y compris le dossier caché `.bible-study`. Ne l'excluez pas.
- Une seule instance de Synesis (ou d'Obsidian) à la fois doit éditer un fichier ; la fusion gère les modifications hors ligne, pas deux curseurs sur la même ligne à la même seconde.
- Réglages → Synchronisation liste chaque appareil qui a publié dans le coffre et la date de sa dernière publication.
