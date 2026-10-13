// Только сборка; native исполнение остаётся отдельной операцией root.
import {buildModernizationNative} from './product-description-qa-bundle.mjs';
console.log(JSON.stringify(await buildModernizationNative('project-inline',process.argv[2])));
