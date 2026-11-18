// Обычная Debug-сборка React Native не содержит код приложения и ждёт сервер разработки на компьютере.
// Здесь код встраивается в APK, поэтому Debug-версия запускается на телефоне сама по себе.
const { withAppBuildGradle } = require('expo/config-plugins');

const LINE = 'debuggableVariants = []';

module.exports = function withEmbeddedDebugBundle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Ожидался android/app/build.gradle на Groovy');
    const source = mod.modResults.contents;
    if (source.split('\n').some((l) => l.trim() === LINE)) return mod;
    const next = source.replace(/^react \{\r?\n/m, (head) => `${head}    ${LINE}\n`);
    if (next === source) throw new Error('В android/app/build.gradle не найден блок react { }');
    mod.modResults.contents = next;
    return mod;
  });
};
