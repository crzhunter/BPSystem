import { heroSnapshot } from './snapshot.ts';

const extra: Record<string, string[]> = {
  antimage: ['敌法', 'am'],
  phantom_assassin: ['幻刺', 'pa'],
  morphling: ['水人', 'morph'],
  earthshaker: ['牛头', '小牛', 'es'],
  nevermore: ['影魔', 'sf'],
  invoker: ['卡尔', 'invoker'],
  medusa: ['大娜迦', '一姐', 'medusa'],
  tiny: ['小小', 'tiny'],
  mars: ['玛尔斯', 'mars'],
  puck: ['帕克', 'puck'],
  pangolier: ['滚滚', 'pango'],
  rubick: ['拉比克', 'rubick'],
  crystal_maiden: ['冰女', 'cm'],
  lion: ['莱恩', 'lion'],
  queenofpain: ['女王', 'qop'],
  storm_spirit: ['蓝猫'],
  ember_spirit: ['火猫'],
  earth_spirit: ['土猫'],
  void_spirit: ['紫猫'],
  windrunner: ['风行', 'wr'],
  juggernaut: ['剑圣', 'jugg'],
  shadow_shaman: ['小歪', 'ss'],
  templar_assassin: ['圣堂', 'ta'],
  phantom_lancer: ['猴子', 'pl'],
  centaur: ['人马'],
  ancient_apparition: ['冰魂', 'aa'],
  doom_bringer: ['末日', 'doom'],
  skeleton_king: ['骷髅王', 'wk'],
};
export const heroAliases = new Map(
  heroSnapshot.map((h) => [
    h.name,
    { cnName: h.cn_name, aliases: extra[h.name.replace('npc_dota_hero_', '')] ?? [] },
  ]),
);
