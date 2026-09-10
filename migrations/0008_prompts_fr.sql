-- The curated library, in French.
--
-- Same rows, same ids, a second text. The pick stays deterministic and stays
-- the group's: two dads get the SAME question on the same day and answer each
-- other, one reading it in English and one in French. A separate French pool
-- would have split the group in half, which is the opposite of the point.
--
-- Tutoiement throughout, and the plain words a man would actually use — these
-- are questions you answer in front of your friends, and nothing kills that
-- faster than sounding like a form.
--
-- `body_fr` is NULL for anything a dad writes himself: he asked it in his own
-- words, in his own language, and translating a man's question for him is not
-- this app's business. The client falls back to `body` when it is missing.
ALTER TABLE prompts ADD COLUMN body_fr TEXT;

UPDATE prompts SET body_fr = 'Tu as perdu patience pour quoi cette semaine, et qu’est-ce qu’il y avait vraiment en dessous?' WHERE id = 'prm_0001';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as haussé le ton avec ton enfant? Tu ferais quoi autrement?' WHERE id = 'prm_0002';
UPDATE prompts SET body_fr = 'Quel comportement de ton enfant te tape sur les nerfs plus vite que ça devrait?' WHERE id = 'prm_0003';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as été sec avec ton enfant pour une raison qui n’avait rien à voir avec lui?' WHERE id = 'prm_0004';
UPDATE prompts SET body_fr = 'Quelle punition as-tu donnée que tu regrettais une heure plus tard?' WHERE id = 'prm_0005';
UPDATE prompts SET body_fr = 'Comment tu sais que tu es sur le point de péter une coche? C’est quoi tes signes?' WHERE id = 'prm_0006';
UPDATE prompts SET body_fr = 'Tu fais quoi pour te calmer, et est-ce que ça marche vraiment?' WHERE id = 'prm_0007';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu t’es excusé auprès de ton enfant? Ça a donné quoi?' WHERE id = 'prm_0008';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu as dit à ton enfant que tu aimerais pouvoir reprendre?' WHERE id = 'prm_0009';
UPDATE prompts SET body_fr = 'Y a-t-il un moment de la journée où tu es un moins bon père? Il se passe quoi à ce moment-là?' WHERE id = 'prm_0010';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton père faisait que tu t’étais juré de ne jamais faire — et que tu t’es surpris à faire?' WHERE id = 'prm_0011';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton père a bien fait que tu veux transmettre?' WHERE id = 'prm_0012';
UPDATE prompts SET body_fr = 'De quoi tu avais besoin de ton père, à l’âge de ton enfant, que tu n’as pas eu?' WHERE id = 'prm_0013';
UPDATE prompts SET body_fr = 'Comment ça va avec ton père aujourd’hui, et ça paraît comment dans ta façon d’être père?' WHERE id = 'prm_0014';
UPDATE prompts SET body_fr = 'Quelle phrase de ton père sort de ta bouche aujourd’hui?' WHERE id = 'prm_0015';
UPDATE prompts SET body_fr = 'Si ton père te voyait élever tes enfants, il dirait quoi?' WHERE id = 'prm_0016';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton père t’a appris sur le fait d’être un homme qui s’est avéré faux?' WHERE id = 'prm_0017';
UPDATE prompts SET body_fr = 'Qui t’a montré comment être père, si ce n’est pas ton père?' WHERE id = 'prm_0018';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu fais autrement que la façon dont tu as été élevé, et est-ce que ça marche?' WHERE id = 'prm_0019';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu espères que ton enfant dira de toi à ses amis dans vingt ans?' WHERE id = 'prm_0020';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as donné toute ton attention à ton enfant, sans téléphone dans la pièce?' WHERE id = 'prm_0021';
UPDATE prompts SET body_fr = 'Ton enfant fait quoi pour avoir ton attention quand il n’arrive pas à l’avoir?' WHERE id = 'prm_0022';
UPDATE prompts SET body_fr = 'Cette semaine, combien de ton temps avec ton enfant était vraiment avec lui?' WHERE id = 'prm_0023';
UPDATE prompts SET body_fr = 'C’est quoi la dernière affaire que ton enfant t’a dite que tu n’as pas vraiment écoutée?' WHERE id = 'prm_0024';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as laissé ton enfant finir son histoire sans le presser?' WHERE id = 'prm_0025';
UPDATE prompts SET body_fr = 'Ton téléphone, ça te coûte quoi à la maison?' WHERE id = 'prm_0026';
UPDATE prompts SET body_fr = 'Qu’est-ce que vous avez fait ensemble cette semaine qui n’avait pas d’autre but que d’être ensemble?' WHERE id = 'prm_0027';
UPDATE prompts SET body_fr = 'Quand tu rentres à la maison, elles ressemblent à quoi, les cinq premières minutes?' WHERE id = 'prm_0028';
UPDATE prompts SET body_fr = 'C’est quoi un petit rituel que tu as avec ton enfant, et il vient d’où?' WHERE id = 'prm_0029';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que vous vous êtes ennuyés ensemble exprès?' WHERE id = 'prm_0030';
UPDATE prompts SET body_fr = 'Quelle règle de la maison tu ne crois pas vraiment toi-même?' WHERE id = 'prm_0031';
UPDATE prompts SET body_fr = 'Où est-ce que tu n’es pas constant, et ton enfant fait quoi avec ça?' WHERE id = 'prm_0032';
UPDATE prompts SET body_fr = 'Quelle limite as-tu tenue cette semaine qui était dure à tenir?' WHERE id = 'prm_0033';
UPDATE prompts SET body_fr = 'Quand est-ce que tu as cédé juste parce que tu étais fatigué?' WHERE id = 'prm_0034';
UPDATE prompts SET body_fr = 'Tu as peur qu’il arrive quoi si tu es sévère?' WHERE id = 'prm_0035';
UPDATE prompts SET body_fr = 'Tu as peur qu’il arrive quoi si tu es mou?' WHERE id = 'prm_0036';
UPDATE prompts SET body_fr = 'Toi et ton partenaire, vous vous obstinez sur quoi côté discipline devant les enfants?' WHERE id = 'prm_0037';
UPDATE prompts SET body_fr = 'Quelle conséquence a vraiment marché, et pourquoi selon toi?' WHERE id = 'prm_0038';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu punis encore que tu devrais probablement laisser aller?' WHERE id = 'prm_0039';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que ton enfant t’a fait changer d’idée sur une règle?' WHERE id = 'prm_0040';
UPDATE prompts SET body_fr = 'De quoi tu as le plus peur pour ton enfant?' WHERE id = 'prm_0041';
UPDATE prompts SET body_fr = 'Tu as peur de lui faire quoi sans t’en rendre compte?' WHERE id = 'prm_0042';
UPDATE prompts SET body_fr = 'Qu’est-ce qui t’empêche de dormir quand tu penses à ta famille?' WHERE id = 'prm_0043';
UPDATE prompts SET body_fr = 'Qu’est-ce qui t’inquiète chez ton enfant que tu n’as jamais dit tout haut?' WHERE id = 'prm_0044';
UPDATE prompts SET body_fr = 'De quoi penses-tu que ton enfant a peur, et lui as-tu demandé?' WHERE id = 'prm_0045';
UPDATE prompts SET body_fr = 'C’est quoi le pire scénario que tu te surprends à imaginer?' WHERE id = 'prm_0046';
UPDATE prompts SET body_fr = 'Quelle part de ta façon d’être père vient de la peur?' WHERE id = 'prm_0047';
UPDATE prompts SET body_fr = 'Qu’est-ce qui t’inquiétait avant et qui s’est avéré n’être rien?' WHERE id = 'prm_0048';
UPDATE prompts SET body_fr = 'Tu ferais quoi si ton enfant te disait quelque chose qui te fait peur?' WHERE id = 'prm_0049';
UPDATE prompts SET body_fr = 'Y a-t-il quelque chose que tu évites de régler parce que c’est trop dur?' WHERE id = 'prm_0050';
UPDATE prompts SET body_fr = 'Comment le travail déteint sur la maison ces temps-ci?' WHERE id = 'prm_0051';
UPDATE prompts SET body_fr = 'Tu montres quoi à ton enfant sur le travail, par ton exemple?' WHERE id = 'prm_0052';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as choisi le travail plutôt que la famille? C’était le bon choix?' WHERE id = 'prm_0053';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu veux que ton enfant comprenne sur l’argent?' WHERE id = 'prm_0054';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu fournis que ton enfant n’a jamais demandé?' WHERE id = 'prm_0055';
UPDATE prompts SET body_fr = 'Ton enfant dirait que tu fais quoi comme travail?' WHERE id = 'prm_0056';
UPDATE prompts SET body_fr = 'Si tu avais une heure de plus par jour, elle irait où, honnêtement?' WHERE id = 'prm_0057';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu sacrifies, et qui a décidé de cet échange-là?' WHERE id = 'prm_0058';
UPDATE prompts SET body_fr = 'Ça veut dire quoi pour toi, bien faire vivre sa famille, et qui t’a appris ça?' WHERE id = 'prm_0059';
UPDATE prompts SET body_fr = 'Es-tu fatigué, ou es-tu épuisé? C’est quoi la différence pour toi en ce moment?' WHERE id = 'prm_0060';
UPDATE prompts SET body_fr = 'Toi et ton partenaire, vous formez une équipe comment, comme parents?' WHERE id = 'prm_0061';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu démolis chez ton partenaire sans le vouloir?' WHERE id = 'prm_0062';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as appuyé ton partenaire devant les enfants même si tu n’étais pas d’accord?' WHERE id = 'prm_0063';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton partenaire fait avec les enfants que tu ne serais pas capable de faire?' WHERE id = 'prm_0064';
UPDATE prompts SET body_fr = 'Quelle conversation sur les enfants tu évites tout le temps avec ton partenaire?' WHERE id = 'prm_0065';
UPDATE prompts SET body_fr = 'Quelle part du travail invisible à la maison tu portes vraiment?' WHERE id = 'prm_0066';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton enfant a vu cette semaine dans ta façon de traiter son autre parent?' WHERE id = 'prm_0067';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que toi et ton partenaire avez parlé d’autre chose que de logistique?' WHERE id = 'prm_0068';
UPDATE prompts SET body_fr = 'Tu montres quoi, par ton exemple, sur ce qu’est un couple?' WHERE id = 'prm_0069';
UPDATE prompts SET body_fr = 'Si tu élèves tes enfants en garde partagée, c’est quoi le plus dur en ce moment?' WHERE id = 'prm_0070';
UPDATE prompts SET body_fr = 'Ton enfant s’intéresse à quoi que tu ne comprends pas?' WHERE id = 'prm_0071';
UPDATE prompts SET body_fr = 'Qu’est-ce que ton enfant fait mieux que toi?' WHERE id = 'prm_0072';
UPDATE prompts SET body_fr = 'Ton enfant devient qui, et ça te fait quoi?' WHERE id = 'prm_0073';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu aimes chez ton enfant qui n’a rien à voir avec toi?' WHERE id = 'prm_0074';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as vu ton enfant être gentil sans que personne le lui demande?' WHERE id = 'prm_0075';
UPDATE prompts SET body_fr = 'Avec quoi ton enfant a de la misère sans te l’avoir dit?' WHERE id = 'prm_0076';
UPDATE prompts SET body_fr = 'En quoi ton enfant est différent de ce que tu imaginais?' WHERE id = 'prm_0077';
UPDATE prompts SET body_fr = 'Toi et ton enfant, vous n’êtes pas d’accord sur quoi?' WHERE id = 'prm_0078';
UPDATE prompts SET body_fr = 'De quoi ton enfant a besoin de toi en ce moment, sans être capable de le demander?' WHERE id = 'prm_0079';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as changé d’idée sur ton enfant?' WHERE id = 'prm_0080';
UPDATE prompts SET body_fr = 'Tu te compares à quel parent, et pourquoi lui?' WHERE id = 'prm_0081';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu veux que le monde pense de toi comme père?' WHERE id = 'prm_0082';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu fais pour ton enfant qui est en fait pour toi?' WHERE id = 'prm_0083';
UPDATE prompts SET body_fr = 'Les succès de ton enfant, tu les prends personnels jusqu’à quel point?' WHERE id = 'prm_0084';
UPDATE prompts SET body_fr = 'Ça voudrait dire quoi si ton enfant était juste ordinaire?' WHERE id = 'prm_0085';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu t’es senti comme un mauvais père?' WHERE id = 'prm_0086';
UPDATE prompts SET body_fr = 'C’était quand, la dernière fois que tu as senti que tu avais fait ça comme il faut?' WHERE id = 'prm_0087';
UPDATE prompts SET body_fr = 'Quelle partie de toi as-tu perdue en devenant père?' WHERE id = 'prm_0088';
UPDATE prompts SET body_fr = 'Qu’est-ce qui te manque de celui que tu étais avant les enfants?' WHERE id = 'prm_0089';
UPDATE prompts SET body_fr = 'Qu’est-ce que la paternité t’a donné auquel tu ne t’attendais pas?' WHERE id = 'prm_0090';
UPDATE prompts SET body_fr = 'C’est quoi une affaire que tu changerais dans ta façon d’être père, dès demain?' WHERE id = 'prm_0091';
UPDATE prompts SET body_fr = 'Où est-ce que tu aurais besoin d’aide en ce moment?' WHERE id = 'prm_0092';
UPDATE prompts SET body_fr = 'Quel conseil on te répète que tu continues d’ignorer?' WHERE id = 'prm_0093';
UPDATE prompts SET body_fr = 'Qu’est-ce qui marche en ce moment que tu devrais faire plus souvent?' WHERE id = 'prm_0094';
UPDATE prompts SET body_fr = 'En quoi tu t’es amélioré dans la dernière année?' WHERE id = 'prm_0095';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu as besoin de te pardonner?' WHERE id = 'prm_0096';
UPDATE prompts SET body_fr = 'Qui dans ta vie te dit la vérité sur ta façon d’être père?' WHERE id = 'prm_0097';
UPDATE prompts SET body_fr = 'Qu’est-ce que tu dirais à un nouveau père que personne ne t’a dit?' WHERE id = 'prm_0098';
UPDATE prompts SET body_fr = 'C’est quoi le plus dur dans le fait d’être père dont personne ne te parle?' WHERE id = 'prm_0099';
UPDATE prompts SET body_fr = 'Si rien ne changeait pour les cinq prochaines années, est-ce que ça irait?' WHERE id = 'prm_0100';
