# Famille

La page d'un Personnage montre sa parenté sous **Famille** : son père, sa mère et ses conjoints, ses enfants, ses frères et sœurs. Chaque lien s'écrit une seule fois, d'un seul côté, comme un lien ordinaire dans les propriétés du Personnage ; l'application lit l'autre côté pour vous et ne l'écrit jamais dans un fichier.

![Deux parents unis comme conjoints, leurs enfants en dessous, chaque enfant relié aux parents qu'il nomme](image:family-tree)

1. Ouvrez la page d'un Personnage avec [Rechercher](command:nav.search), par exemple Jacob dans le coffre de démonstration. Sous **Famille** viennent son **Père** et sa **Mère**, ses **Conjoints**, ses **Enfants** groupés sous la mère que chacun nomme, et ses **Frères et sœurs**.
2. Cliquez sur son père, Isaac. Le fichier d'Isaac ne nomme aucun de ses fils, et pourtant ses **Enfants** listent Jacob et Ésaü : leurs propres fichiers nomment Isaac comme `father`. Il en va de même des conjoints : le fichier de Léa ne nomme personne, et sa page liste quand même Jacob, parce que Jacob la nomme.
3. Regardez les **Frères et sœurs** d'Isaac : ils sont groupés par les parents qu'ils ont en commun. Ismaël est sous Abraham seul, un demi-frère ; un frère ou une sœur de mêmes parents serait sous les deux. Revenez avec [Retour](command:nav.back).
4. Essayez une fois : ouvrez la page d'un Personnage que vous étudiez et lisez sa **Famille**. Si elle est vide, nommez un parent sous **Propriétés** : ajoutez `father` (ou `mother`) avec un lien vers le parent, comme `[[Isaac]]`. Ouvrez la page du parent : le Personnage figure maintenant parmi ses **Enfants**.

## À savoir

- La parenté tient en trois propriétés d'un Personnage : `father` et `mother`, un lien chacune, et `spouses`, une liste de liens. Enfants, frères et sœurs ne s'écrivent jamais : ils se lisent depuis l'autre côté. Obsidian lit les mêmes liens, et montre l'autre côté dans ses liens entrants.
- Un mariage s'écrit sur l'un des conjoints, ou sur les deux : il apparaît une fois de chaque côté.
- Un Personnage a un père et une mère. Un père légal ou adoptif, ou une généalogie qui saute des générations, trouve sa place dans l'À propos de la page.
- Quand un lien ne peut pas être lu, la section Famille dit pourquoi et le laisse de côté : un `father` qui nomme un Lieu, un `father` qui contient deux liens, ou un Personnage qui serait son propre ancêtre. Le fichier reste tel que vous l'avez écrit ; corrigez-le sous **Propriétés**.
