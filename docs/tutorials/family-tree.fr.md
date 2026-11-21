# Famille

La page d'un Personnage montre sa parenté sous **Famille** : son père, sa mère et ses conjoints, ses enfants, ses frères et sœurs. Vous la remplissez sur place, en choisissant chaque Personnage par son nom. Chaque lien s'écrit une seule fois, d'un seul côté, comme un lien ordinaire dans le fichier du Personnage ; l'application lit l'autre côté pour vous et ne l'écrit jamais dans un fichier.

![Deux parents unis comme conjoints, leurs enfants en dessous, chaque enfant relié aux parents qu'il nomme](image:family-tree)

1. Ouvrez la page d'un Personnage avec [Rechercher](command:nav.search), par exemple Jacob dans le coffre de démonstration. Sous **Famille** viennent son **Père** et sa **Mère**, ses **Conjoints**, ses **Enfants** groupés sous la mère que chacun nomme, et ses **Frères et sœurs**.
2. Cliquez sur son père, Isaac. Le fichier d'Isaac ne nomme aucun de ses fils, et pourtant ses **Enfants** listent Jacob et Ésaü : leurs propres fichiers nomment Isaac comme `father`. Il en va de même des conjoints : le fichier de Léa ne nomme personne, et sa page liste quand même Jacob, parce que Jacob la nomme.
3. Regardez les **Frères et sœurs** d'Isaac : ils sont groupés par les parents qu'ils ont en commun. Ismaël est sous Abraham seul, un demi-frère ; un frère ou une sœur de mêmes parents serait sous les deux. Revenez avec [Retour](command:nav.back).
4. Ouvrez la page de Léa avec [Rechercher](command:nav.search). Aucun père n'est nommé : sous **Père**, appuyez sur **Choisir…** et tapez Laban. Aucun Personnage ne porte ce nom : choisissez **Créer le Personnage « Laban »**. Laban est créé et le fichier de Léa le nomme comme son `father`. Le × à côté d'un parent le retire, et le × à côté d'un conjoint le retire, du seul fichier de ce Personnage.
5. Ouvrez la page de Joseph et appuyez sur **Ajouter un enfant**, puis créez Manassé de la même façon. Joseph n'est encore le parent de personne : on vous demande s'il est le père ou la mère, choisissez **Père**. Le fichier de Manassé nomme maintenant Joseph comme son `father` ; celui de Joseph reste tel quel. Le prochain **Ajouter un enfant** sur Joseph ne pose plus la question.
6. Essayez une fois : ouvrez la page d'un Personnage que vous étudiez et, sous **Père**, appuyez sur **Choisir…** et choisissez son père, ou créez-le. Ouvrez la page du père : le Personnage figure maintenant parmi ses **Enfants**.

## À savoir

- La parenté tient en trois propriétés d'un Personnage : `father` et `mother`, un lien chacune, et `spouses`, une liste de liens. Enfants, frères et sœurs ne s'écrivent jamais : ils se lisent depuis l'autre côté. Obsidian lit les mêmes liens, et montre l'autre côté dans ses liens entrants.
- Un mariage s'écrit sur l'un des conjoints, ou sur les deux : il apparaît une fois de chaque côté. **Ajouter un conjoint** l'écrit sur le Personnage dont vous êtes sur la page.
- **Ajouter un enfant** écrit le `father` ou la `mother` de l'enfant, jamais rien sur le parent. Un enfant qui nomme déjà un autre père (ou une autre mère) est refusé, avec le nom de celui qui y est déjà, et rien n'est écrit.
- Le sélecteur trouve un Personnage par son titre ou par un Alias : Abram trouve Abraham. Un Personnage créé depuis le sélecteur commence comme tout nouveau Personnage.
- `father`, `mother` et `spouses` ne figurent pas sous **Propriétés** : c'est sous **Famille** qu'on les modifie.
- Un Personnage a un père et une mère. Un père légal ou adoptif, ou une généalogie qui saute des générations, trouve sa place dans l'À propos de la page.
- Quand un lien ne peut pas être lu, la section Famille dit pourquoi et le laisse de côté : un `father` qui nomme un Lieu, un `father` qui contient deux liens, ou un Personnage qui serait son propre ancêtre. Le fichier reste tel que vous l'avez écrit ; choisissez le bon sous **Famille**, ou retirez-le avec ×.
