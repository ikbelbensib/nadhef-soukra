-- 0003_badges_seed — catalogue de badges.
-- condition_json est évalué par server/src/services/badges.ts (Phase 3) :
--   { "metric": <compteur>, "op": ">=", "value": <seuil> }

INSERT INTO badges (id, code, nom_fr, nom_ar, description_fr, description_ar, condition_json) VALUES
  ('bdg_premier_signalement', 'premier_signalement',
   'Premier signalement', 'أول إبلاغ',
   'Vous avez signalé votre premier point noir.',
   'أبلغت عن أول نقطة سوداء.',
   '{"metric":"spots_approuves","op":">=","value":1}'),

  ('bdg_sentinelle', 'sentinelle',
   'Sentinelle', 'حارس',
   'Dix signalements approuvés.',
   'عشرة إبلاغات مقبولة.',
   '{"metric":"spots_approuves","op":">=","value":10}'),

  ('bdg_vigie', 'vigie',
   'Vigie', 'مراقب',
   'Vingt-cinq reconfirmations sur le terrain.',
   'خمسة وعشرون تأكيدًا ميدانيًا.',
   '{"metric":"reconfirmations","op":">=","value":25}'),

  ('bdg_premier_chantier', 'premier_chantier',
   'Premier chantier', 'أول حملة',
   'Vous avez participé à un chantier de nettoyage.',
   'شاركت في حملة تنظيف.',
   '{"metric":"participations","op":">=","value":1}'),

  ('bdg_habitue', 'habitue',
   'Habitué', 'مواظب',
   'Cinq chantiers à votre actif.',
   'خمس حملات في رصيدك.',
   '{"metric":"participations","op":">=","value":5}'),

  ('bdg_organisateur', 'organisateur',
   'Organisateur', 'منظّم',
   'Vous avez mené un chantier à terme.',
   'أتممت حملة حتى نهايتها.',
   '{"metric":"organisations","op":">=","value":1}'),

  ('bdg_meneur', 'meneur',
   'Meneur', 'قائد',
   'Cinq chantiers organisés et menés à terme.',
   'خمس حملات نظّمتها وأتممتها.',
   '{"metric":"organisations","op":">=","value":5}'),

  ('bdg_nettoyeur', 'nettoyeur',
   'Nettoyeur', 'منظّف',
   'Dix points noirs fermés avec preuve avant/après.',
   'عشر نقاط سوداء أُغلقت بدليل قبل/بعد.',
   '{"metric":"spots_fermes","op":">=","value":10}'),

  ('bdg_tonne', 'tonne',
   'Une tonne', 'طن كامل',
   'Mille kilos collectés lors de chantiers auxquels vous avez pris part.',
   'ألف كيلوغرام جُمعت في حملات شاركت فيها.',
   '{"metric":"kg_collectes","op":">=","value":1000}');
