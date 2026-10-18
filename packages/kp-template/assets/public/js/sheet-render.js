(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.SheetRender = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function fmt(n) {
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n || 0);
    }

    function digits(s) { return String(s || '').replace(/[^\d]/g, ''); }
    function warrantyLabel(s) {
      if (s.warrantyMonths == null) return '2 года';
      var months = Math.max(1, Math.round(+s.warrantyMonths) || 12), n = months % 100, last = n % 10;
      return months + ' ' + (n > 10 && n < 20 ? 'месяцев' : last === 1 ? 'месяц' : last >= 2 && last <= 4 ? 'месяца' : 'месяцев');
    }
    function webHref(s) { s = String(s || ''); return /^https?:\/\//i.test(s) ? s : 'https://' + s; }

    function linkify(text) {
      var s = esc(text);
      s = s.replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>');
      s = s.replace(/(\+[\d][\d\s().-]{6,}\d)/g, function (m) { return '<a href="tel:+' + digits(m) + '">' + m + '</a>'; });
      s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return s;
    }

    var CYR_TO_LAT = {
      А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Zh', З: 'Z', И: 'I',
      Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T',
      У: 'U', Ф: 'F', Х: 'H', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Sch', Ъ: '', Ы: 'Y',
      Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya'
    };

    function toLatin(s) {
      return String(s || '').split('').map(function (c) { return CYR_TO_LAT[c.toUpperCase()] || c; }).join('');
    }

    function pdfFileName(s) {
      var num = (s.order && s.order.number) || 'export';
      var safe = toLatin(num).replace(/[^a-zA-Z0-9\-_.]/g, '_').replace(/_+/g, '_');
      return 'kp_' + safe + '_Pero.pdf';
    }

    function num(v, fallback) {
      var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v;
      return Number.isFinite(n) ? n : (fallback || 0);
    }

    function amountMinor(value) { return Math.round((num(value) + Number.EPSILON) * 100); }

    function normalizeState(s) {
      if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.items)) return null;
      var state = Object.assign({}, s);
      state.discount = Math.max(num(s.discount), 0);
      state.discountMode = s.discountMode === 'amount' ? 'amount' : 'percent';
      state.items = s.items.filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
        var item = Object.assign({}, it);
        item.price = Math.max(amountMinor(it.price), 0) / 100;
        item.qty = qtyOf(it);
        item.dbl = it.dbl === true;
        item.products = (Array.isArray(it.products) ? it.products : [])
          .filter(function (p) { return p && typeof p === 'object'; });
        return item;
      });
      var d = s.delivery && typeof s.delivery === 'object' && !Array.isArray(s.delivery) ? s.delivery : {};
      state.delivery = {
        mode: d.mode === 'items' ? 'items' : 'total',
        total: Math.max(amountMinor(d.total), 0) / 100,
        visible: d.visible !== false,
        items: (Array.isArray(d.items) ? d.items : [])
          .filter(function (it) { return it && typeof it === 'object'; })
          .map(function (it) { var row = { name: it.name, price: Math.max(amountMinor(it.price), 0) / 100 }; if (['DELIVERY', 'UNLOADING', 'INSTALLATION'].indexOf(it.crmKind) >= 0) row.crmKind = it.crmKind; return row; })
      };
      return state;
    }

    function qtyOf(it) { return Math.max(1, Math.round(+it.qty) || 1); }
    function subtotalOf(s) {
      return s.items.reduce(function (a, it) { return a + amountMinor(it.price) * qtyOf(it); }, 0) / 100;
    }

    function deliveryAmount(s) {
      var d = s.delivery || {};
      if (d.visible === false) return 0;
      if (d.mode === 'items') {
        return (d.items || []).reduce(function (a, it) { return a + amountMinor(it.price); }, 0) / 100;
      }
      return amountMinor(d.total) / 100;
    }

    function totalsOf(s) {
      var sub = subtotalOf(s);
      var del = deliveryAmount(s);
      var base = sub + del;
      var mode = s.discountMode === 'amount' ? 'amount' : 'percent';
      var val = Math.max(+s.discount || 0, 0);
      var disc, d;
      if (mode === 'amount') {
        disc = Math.min(val, base);
        d = base > 0 ? +(disc / base * 100).toFixed(1) : 0;
      } else {
        d = Math.min(val, 100);
        disc = base * d / 100;
      }
      disc = Math.round((disc + Number.EPSILON) * 100) / 100;
      return { sub: sub, del: del, base: base, disc: disc, total: Math.round((base - disc + Number.EPSILON) * 100) / 100, d: d, mode: mode };
    }

    function discountLabel(T, cur) {
      if (T.disc <= 0) return '';
      return T.mode === 'amount' ? fmt(T.disc) + ' ' + cur : T.d + ' %';
    }

    var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1500" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%"><g fill="currentColor" fill-rule="nonzero" shape-rendering="geometricPrecision"><path d="M 537.070312 223.714844 C 517.417969 193.746094 491.621094 171.113281 459.660156 155.78125 C 443.664062 148.464844 426.691406 143.472656 408.699219 140.800781 C 390.722656 138.144531 372.074219 136.804688 352.765625 136.804688 C 338.78125 136.804688 327.945312 137.308594 320.292969 138.308594 C 312.628906 139.304688 306.464844 140.140625 301.820312 140.800781 C 301.136719 144.796875 300.320312 148.296875 299.3125 151.292969 C 298.320312 154.289062 297.46875 158.128906 296.816406 162.78125 C 296.152344 167.441406 295.472656 173.9375 294.820312 182.261719 C 294.15625 190.59375 293.472656 202.410156 292.824219 217.722656 C 292.15625 241.042969 291.644531 269.34375 291.320312 302.636719 C 290.980469 335.945312 290.824219 368.570312 290.824219 400.53125 L 290.824219 528.402344 C 318.125 528.402344 343.769531 527.582031 367.742188 525.90625 C 391.726562 524.25 414.027344 519.761719 434.683594 512.421875 C 477.296875 497.78125 509.925781 473.628906 532.578125 439.996094 C 555.21875 406.371094 566.539062 368.570312 566.539062 326.613281 C 566.539062 287.992188 556.707031 253.6875 537.070312 223.714844 Z M 662.4375 398.535156 C 654.449219 418.519531 643.964844 436.171875 630.972656 451.488281 C 617.996094 466.808594 602.835938 479.957031 585.523438 490.941406 C 568.195312 501.929688 550.558594 510.765625 532.578125 517.414062 C 513.921875 524.082031 493.945312 529.074219 472.636719 532.402344 C 451.3125 535.742188 429.835938 538.242188 408.203125 539.890625 C 386.554688 541.5625 365.402344 542.390625 344.777344 542.390625 L 290.824219 542.390625 L 290.824219 636.292969 C 290.824219 647.628906 290.980469 658.113281 291.320312 667.757812 C 291.644531 677.421875 291.832031 687.914062 291.832031 699.234375 C 292.480469 720.546875 293.148438 738.859375 293.828125 754.175781 C 294.480469 769.503906 298.152344 782.148438 304.808594 792.136719 C 310.136719 800.800781 320.449219 809.464844 335.777344 818.105469 C 351.09375 826.769531 372.402344 831.761719 399.714844 833.09375 L 399.714844 843.082031 L 80.042969 843.082031 L 80.042969 833.09375 C 96.6875 830.4375 112.667969 826.445312 128 821.101562 C 143.296875 815.78125 155.300781 807.792969 163.957031 797.128906 C 167.285156 793.132812 169.949219 787.144531 171.945312 779.144531 C 173.945312 771.152344 175.445312 762.164062 176.4375 752.175781 C 177.441406 742.1875 178.261719 731.542969 178.945312 720.207031 C 179.597656 708.890625 179.9375 697.902344 179.9375 687.242188 C 179.9375 677.925781 180.09375 665.265625 180.433594 649.277344 C 180.773438 633.296875 181.097656 615.816406 181.4375 596.839844 C 181.765625 577.851562 181.933594 558.375 181.933594 538.398438 L 181.933594 285.65625 C 181.933594 273.664062 181.765625 261.523438 181.4375 249.1875 C 181.097656 236.878906 180.433594 225.21875 179.441406 214.222656 C 178.433594 203.238281 176.777344 193.25 174.4375 184.257812 C 172.101562 175.261719 168.957031 168.773438 164.960938 164.78125 C 154.957031 154.132812 142.136719 146.964844 126.496094 143.300781 C 110.839844 139.644531 94.023438 136.480469 76.046875 133.808594 L 76.046875 123.820312 L 100.015625 123.820312 C 112.667969 123.820312 127.488281 123.667969 144.476562 123.316406 C 161.460938 122.992188 179.9375 122.820312 199.910156 122.820312 C 219.90625 122.820312 239.710938 122.667969 259.359375 122.320312 C 278.996094 121.992188 297.46875 121.824219 314.796875 121.824219 L 359.75 121.824219 C 403.710938 121.824219 442.671875 123.992188 476.632812 128.3125 C 510.605469 132.65625 542.566406 143.144531 572.53125 159.785156 C 601.828125 175.765625 626.140625 198.414062 645.46875 227.710938 C 664.777344 257.023438 674.4375 291.648438 674.4375 331.609375 C 674.4375 356.253906 670.445312 378.558594 662.4375 398.535156 Z"/><path d="M 756.785156 1339.730469 C 733.46875 1323.769531 709.5 1298.449219 684.835938 1263.824219 C 668.871094 1241.160156 650.71875 1215.191406 630.382812 1185.871094 C 610.089844 1156.59375 591.242188 1129.277344 573.929688 1103.957031 C 563.96875 1089.949219 553.636719 1077.289062 542.980469 1065.980469 C 532.320312 1054.671875 521.289062 1046.015625 509.984375 1040.011719 L 509.984375 1036.988281 C 531.996094 1029.679688 552.984375 1020.695312 572.953125 1010.039062 C 592.917969 999.382812 610.414062 986.535156 625.402344 971.550781 C 640.390625 956.5625 652.394531 939.253906 661.378906 919.613281 C 670.359375 899.972656 674.875 877.820312 674.875 853.152344 C 674.875 813.171875 665.847656 780.035156 647.878906 753.742188 C 629.917969 727.445312 606.226562 706.597656 576.953125 691.285156 C 548.285156 675.972656 516.636719 666.992188 482.011719 664.289062 C 447.386719 661.636719 407.734375 660.335938 363.101562 660.335938 L 333.128906 660.335938 C 333.175781 662.335938 333.222656 664.335938 333.3125 666.246094 C 333.40625 669.363281 333.5 672.480469 333.59375 675.691406 C 340.109375 675.460938 347.648438 675.320312 356.121094 675.320312 C 375.433594 675.320312 393.910156 676.949219 411.59375 680.300781 C 429.234375 683.652344 446.035156 688.957031 462.046875 696.261719 C 494.019531 711.621094 518.3125 732.238281 534.976562 758.210938 C 551.636719 784.226562 559.964844 813.871094 559.964844 847.148438 C 559.964844 865.160156 557.59375 882.472656 552.984375 899.132812 C 548.285156 915.796875 541.117188 931.246094 531.484375 945.582031 C 521.800781 959.914062 509.328125 972.714844 494.019531 984.023438 C 478.707031 995.378906 460.371094 1004.359375 439.054688 1011.015625 C 417.085938 1018.371094 394.234375 1023.210938 370.59375 1025.492188 C 346.949219 1027.863281 321.496094 1029.027344 294.175781 1029.027344 L 185.269531 1029.027344 L 185.269531 1075.988281 C 185.269531 1095.953125 185.082031 1115.453125 184.757812 1134.441406 C 184.433594 1153.429688 184.105469 1170.882812 183.734375 1186.894531 C 183.40625 1202.855469 183.269531 1215.515625 183.269531 1224.871094 C 183.269531 1235.527344 182.945312 1246.511719 182.289062 1257.820312 C 181.59375 1269.175781 180.753906 1279.789062 179.777344 1289.792969 C 178.753906 1299.800781 177.265625 1308.78125 175.265625 1316.789062 C 173.261719 1324.792969 170.609375 1330.75 167.257812 1334.75 C 158.601562 1345.410156 146.59375 1353.414062 131.328125 1358.722656 C 115.972656 1364.074219 100.007812 1368.074219 83.34375 1370.726562 L 83.34375 1380.734375 L 403.078125 1380.734375 L 403.078125 1370.726562 C 375.757812 1369.378906 354.441406 1364.210938 339.132812 1355.230469 C 323.820312 1346.246094 313.488281 1337.453125 308.136719 1328.75 C 301.480469 1318.789062 297.804688 1306.128906 297.199219 1290.820312 C 296.5 1275.460938 295.851562 1257.167969 295.199219 1235.851562 C 294.5 1213.839844 294.175781 1186.894531 294.175781 1154.921875 L 294.175781 1042.011719 C 303.480469 1042.664062 311.160156 1042.988281 317.164062 1042.988281 C 323.820312 1042.988281 333.453125 1044.339844 346.113281 1046.992188 C 363.472656 1050.34375 379.949219 1058.675781 395.585938 1071.984375 C 411.222656 1085.296875 425.695312 1099.628906 439.054688 1114.941406 C 455.015625 1133.605469 468.886719 1150.40625 480.523438 1165.390625 C 492.15625 1180.378906 503 1195.222656 513.007812 1209.886719 C 522.964844 1224.546875 532.785156 1239.34375 542.46875 1254.332031 C 552.101562 1269.316406 563.269531 1286.164062 575.929688 1304.78125 C 586.589844 1320.140625 594.40625 1331.585938 599.433594 1339.265625 C 604.414062 1346.898438 608.554688 1352.761719 611.90625 1356.71875 C 615.253906 1360.722656 618.234375 1364.210938 620.886719 1367.238281 C 623.539062 1370.214844 627.914062 1374.730469 633.871094 1380.734375 L 838.742188 1380.734375 L 838.742188 1370.726562 C 807.421875 1366.074219 780.101562 1355.742188 756.785156 1339.730469 Z"/><path d="M 1329.875 843.199219 L 718.398438 843.199219 L 718.398438 833.210938 C 735.046875 830.554688 750.519531 826.21875 764.863281 820.214844 C 779.171875 814.222656 790.988281 805.90625 800.328125 795.242188 C 803.660156 791.246094 806.324219 785.421875 808.320312 777.757812 C 810.320312 770.105469 812.148438 761.269531 813.820312 751.28125 C 815.476562 741.289062 816.640625 730.796875 817.320312 719.808594 C 817.96875 708.8125 818.3125 697.996094 818.3125 687.332031 C 818.3125 678.015625 818.464844 665.355469 818.804688 649.363281 C 819.148438 633.378906 819.472656 615.890625 819.8125 596.914062 C 820.136719 577.925781 820.308594 558.441406 820.308594 538.460938 L 820.308594 285.675781 C 820.308594 273.679688 820.136719 261.367188 819.8125 248.707031 C 819.472656 236.058594 818.804688 224.066406 817.816406 212.734375 C 816.808594 201.414062 815.152344 191.253906 812.8125 182.261719 C 810.472656 173.265625 807.328125 166.773438 803.335938 162.78125 C 793.328125 152.132812 782.671875 145.292969 771.351562 142.296875 C 760.015625 139.300781 745.378906 136.472656 727.394531 133.800781 L 727.394531 123.8125 L 1278.921875 123.8125 L 1346.867188 288.671875 L 1336.875 293.667969 C 1282.914062 226.394531 1232.285156 181.101562 1185.003906 157.785156 C 1173.664062 152.457031 1152.695312 147.785156 1122.058594 143.792969 C 1091.40625 139.796875 1054.113281 137.796875 1010.144531 137.796875 C 996.15625 137.796875 981.675781 138.300781 966.683594 139.300781 C 951.707031 140.296875 940.867188 141.46875 934.222656 142.792969 C 932.875 153.457031 931.714844 175.441406 930.722656 208.742188 C 929.714844 242.054688 929.21875 280.671875 929.21875 324.644531 L 929.21875 388.585938 C 929.21875 405.914062 929.375 420.054688 929.714844 431.054688 C 930.039062 442.042969 930.226562 450.535156 930.226562 456.53125 L 930.226562 467.519531 L 950.207031 467.519531 C 960.195312 467.519531 971.6875 467.195312 984.664062 466.519531 C 997.660156 465.863281 1010.65625 465.015625 1023.632812 464.019531 C 1036.628906 463.019531 1047.453125 461.527344 1056.113281 459.527344 C 1076.09375 454.875 1092.742188 448.539062 1106.074219 440.539062 C 1119.378906 432.546875 1130.203125 422.898438 1138.539062 411.570312 C 1146.871094 400.246094 1153.53125 387.089844 1158.535156 372.097656 C 1163.519531 357.113281 1168.011719 340.300781 1172.007812 321.636719 L 1184.011719 321.636719 L 1184.011719 636.375 L 1172.007812 636.375 C 1166.679688 615.066406 1158.535156 593.085938 1147.535156 570.429688 C 1136.539062 547.792969 1125.046875 530.808594 1113.058594 519.472656 C 1102.40625 510.15625 1089.582031 502.488281 1074.605469 496.496094 C 1059.609375 490.503906 1042.125 486.847656 1022.148438 485.5 C 1012.15625 484.851562 1003.808594 484.347656 997.164062 484.007812 C 990.492188 483.679688 983.828125 483.503906 977.1875 483.503906 L 931.21875 483.503906 C 929.871094 492.839844 929.21875 506.488281 929.21875 524.46875 L 929.21875 644.367188 C 929.21875 655.03125 929.375 665.199219 929.714844 674.839844 C 930.039062 684.503906 930.226562 692.671875 930.226562 699.324219 C 930.878906 720.644531 932.039062 740.789062 933.710938 759.769531 C 935.367188 778.757812 939.207031 792.910156 945.203125 802.234375 C 951.195312 811.574219 965.523438 818.21875 988.167969 822.214844 C 1010.808594 826.21875 1035.449219 828.214844 1062.105469 828.214844 C 1073.425781 828.214844 1087.910156 827.882812 1105.566406 827.21875 C 1123.203125 826.558594 1141.695312 824.886719 1161.027344 822.214844 C 1182.335938 819.566406 1201.992188 814.394531 1219.972656 806.734375 C 1237.953125 799.085938 1255.269531 788.25 1271.933594 774.257812 C 1288.570312 760.269531 1304.722656 743.125 1320.382812 722.804688 C 1336.023438 702.492188 1352.195312 678.015625 1368.84375 649.363281 L 1379.839844 652.359375 Z"/><path d="M 1398.753906 873.152344 C 1392.613281 857.007812 1385.492188 841.511719 1377.351562 826.761719 L 1370.324219 853.65625 L 1362.132812 884.925781 L 1283.265625 884.925781 C 1283.683594 886.324219 1284.007812 887.765625 1284.378906 889.160156 C 1294.710938 930.480469 1299.828125 971.429688 1299.828125 1012.050781 C 1299.828125 1053.976562 1294.710938 1095.945312 1284.378906 1137.917969 C 1274.050781 1179.84375 1258.554688 1217.671875 1237.941406 1251.3125 C 1217.28125 1284.910156 1191.457031 1312.410156 1160.515625 1333.722656 C 1129.523438 1355.03125 1093.042969 1365.6875 1051.121094 1365.6875 C 1009.148438 1365.6875 972.339844 1356.011719 940.699219 1336.699219 C 909.058594 1317.390625 882.769531 1291.75 861.785156 1259.785156 C 840.796875 1227.816406 824.976562 1190.871094 814.367188 1148.898438 C 803.664062 1106.925781 798.359375 1063.328125 798.359375 1018.007812 C 798.359375 974.734375 803.199219 931.96875 812.832031 889.671875 C 813.203125 888.089844 813.578125 886.507812 813.949219 884.925781 L 695.664062 884.925781 C 681.519531 924.339844 674.492188 967.660156 674.492188 1015.027344 C 674.492188 1068.957031 684.3125 1118.421875 703.949219 1163.371094 C 723.585938 1208.320312 750.433594 1246.988281 784.355469 1279.28125 C 818.320312 1311.574219 857.964844 1336.558594 903.242188 1354.195312 C 948.519531 1371.832031 996.492188 1380.671875 1047.117188 1380.671875 C 1098.394531 1380.671875 1146.835938 1371.691406 1192.433594 1353.683594 C 1238.082031 1335.722656 1278.003906 1310.085938 1312.347656 1276.769531 C 1346.640625 1243.449219 1373.765625 1204.175781 1393.730469 1158.902344 C 1413.738281 1113.582031 1423.742188 1064.304688 1423.742188 1011.027344 C 1423.742188 963.097656 1415.414062 917.125 1398.753906 873.152344 Z M 1212.445312 676.371094 C 1167.492188 656.410156 1116.683594 646.40625 1060.101562 646.40625 C 1029.621094 646.40625 999.980469 649.339844 971.179688 655.199219 C 971.226562 661.667969 971.363281 667.625 971.550781 673.304688 C 971.597656 674.371094 971.644531 675.441406 971.691406 676.46875 C 994.722656 667.71875 1020.222656 663.390625 1048.09375 663.390625 C 1090.71875 663.390625 1127.664062 673.859375 1158.980469 694.84375 C 1183.964844 711.597656 1205.695312 732.394531 1224.125 757.246094 C 1231.148438 752.871094 1238.128906 747.753906 1244.96875 742.027344 C 1255.066406 733.515625 1265.207031 723.371094 1275.167969 711.785156 C 1255.996094 698.242188 1235.105469 686.421875 1212.445312 676.371094 Z"/></g></svg>';

    var IC_WA = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.03c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z"/></svg>';
    var IC_TG = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    var IC_VB = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
    var IC_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.15" fill="#fff" stroke="none"/></svg>';

    var PRODUCT_FIELDS = [
      { key: 'outer',    label: 'Материал наружный' },
      { key: 'inner',    label: 'Материал внутренний' },
      { key: 'hinges',   label: 'Фурнитура' },
      { key: 'drawers',  label: 'Выдвижные ящики' },
      { key: 'lighting', label: 'Подсветка' }
    ];

    function buildPages(s) {
      var items = s.items || [];
      var pages = [];
      var N = items.length;
      if (N === 0) { pages.push({ cover: true, items: [], footer: true }); return pages; }
      pages.push({ cover: true, items: [], footer: false });
      var buffer = [];
      items.forEach(function (it) {
        if (it.dbl) {
          while (buffer.length >= 2) {
            pages.push({ cover: false, items: [buffer.shift(), buffer.shift()], footer: false });
          }
          if (buffer.length) {
            pages.push({ cover: false, items: [buffer.shift()], footer: false });
          }
          pages.push({ cover: false, items: [it], footer: false });
        } else {
          buffer.push(it);
        }
      });
      while (buffer.length >= 2) {
        pages.push({ cover: false, items: [buffer.shift(), buffer.shift()], footer: false });
      }
      pages.push({ cover: false, items: buffer, footer: true });
      return pages;
    }

    function coverHTML(s) {
      var adv = [
        '20+ лет на рынке',
        '1000+ законченных объектов',
        'собственное производство в Республике Беларусь',
        'собственный конструкторский и дизайнерский отдел',
        'доставка изделий собственным автотранспортом',
        'возможность создания эксклюзивных изделий',
        'высокое качество за счёт контроля — от закупки материалов до доставки изделий к вам',
        'постоянная связь с клиентом и информирование об этапах работы',
        'быстрые сроки изготовления и монтажа',
        warrantyLabel(s) + ' гарантии и возможность постгарантийного обслуживания'
      ];
      return (
        headerHTML(s) +
        '<div class="sh-coverSec">' +
        '<div class="sh-coverLabel">О сотрудничестве</div>' +
        '<div class="sh-coverText">Компания «Перо Лайв» — опытнейшая команда профессионалов, которая за 20+ лет своей деятельности завершила более 1000 проектов (объектов), зарекомендовав себя как производитель дизайнерской и нестандартной мебели под любые нужды клиентов. Мы гарантируем качество наших изделий, потому что владеем собственным производством на территории Республики Беларусь, и за счёт полного контроля производственной цепочки можем гарантировать высочайшее качество. Также наши сотрудники выполняют ремонты любой сложности, если ремонт помещения не выполнен на момент заказа мебели. Качество строительных и отделочных работ наших сотрудников также на высоте, что важно для правильной установки мебели и поддержания её в отличном состоянии на долгие годы.</div>' +
        '<div class="sh-coverText">Мы используем только качественные материалы — собственного производства либо закупленные у поставщиков оригинальных материалов, таких как Blum, Boyard, Hettich, Inoxa, Senosan, Formica, Arpa, Alvic, Cleaf, Resopal, Saviola, Egger, Kronospan, Volpato.</div>' +
        '<div class="sh-coverText">«Перо Лайв» предоставляет полный перечень услуг: проектирование, изготовление на собственном производстве, доставку, сборку и монтаж мебели, ремонтные и отделочные работы, предшествующие монтажу мебели, а также гарантийное и постгарантийное обслуживание.</div>' +
        '</div>' +
        '<div class="sh-coverSec">' +
        '<div class="sh-coverLabel">Преимущества работы с нами</div>' +
        '<ul class="sh-adv">' + adv.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
        '</div>'
      );
    }

    function headerHTML(s) {
      var h = s.header || {}, o = s.order || {}, c = s.client || {};
      var logo = '<div class="sh-logo">' + LOGO + '</div>';
      var kicker = 'КП № ' + esc(o.number) + ' · от ' + esc(o.date) + (o.validUntil ? ' · действительно до ' + esc(o.validUntil) : '');
      var p1 = digits(h.phone), p2 = digits(h.phone2);
      var instUser = String(h.instagram || '').replace(/^@/, '');
      var mess = '';
      if (p2) {
        mess = '<span class="sh-messRow">' +
          '<a class="sh-mess" href="https://wa.me/' + p2 + '" target="_blank" rel="noopener" title="WhatsApp"><span class="sh-messDot wa">' + IC_WA + '</span></a>' +
          '<a class="sh-mess" href="tg://resolve?phone=' + p2 + '" title="Telegram"><span class="sh-messDot tg">' + IC_TG + '</span></a>' +
          '<a class="sh-mess" href="viber://chat?number=%2B' + p2 + '" title="Viber"><span class="sh-messDot vb">' + IC_VB + '</span></a>' +
        '</span>';
      }
      return (
        '<div class="sh-covTop">' +
        '<div class="sh-brandCol">' + logo +
        '<div><div class="sh-company">' + esc(h.company) + '</div>' +
        '<div class="sh-tagline">Ваше желание — наша реализация</div></div>' +
        '</div>' +
        '<div class="sh-covRight">' +
        '<div class="sh-coverReq">ООО «ПеРо Лайв»<br>Беларусь, Брестская обл., г. Кобрин,<br>ул. Железнодорожная, 50<br>УНП 291231014<br>Р/С BY08BAPB30122198800100000000<br>ОАО «Белагропромбанк», г. Минск, BAPBBY2X</div>' +
        '<div class="sh-contacts">' +
        (h.email ? '<div><a href="mailto:' + esc(h.email) + '">' + esc(h.email) + '</a></div>' : '') +
        (h.phone ? '<div><a href="tel:+' + p1 + '">' + esc(h.phone) + '</a></div>' : '') +
        (h.phone2 ? '<div><a href="tel:+' + p2 + '">' + esc(h.phone2) + '</a>' + mess + '</div>' : '') +
        (h.instagram ? '<div><a href="https://instagram.com/' + esc(instUser) + '" target="_blank" rel="noopener" title="Instagram">' + esc(h.instagram) + '<span class="sh-messRow"><span class="sh-messDot ig">' + IC_IG + '</span></span></a></div>' : '') +
        (h.site ? '<div><a href="' + esc(webHref(h.site)) + '" target="_blank" rel="noopener">' + esc(h.site) + '</a></div>' : '') +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="sh-kicker">' + kicker + '</div>' +
        '<div class="sh-title">Коммерческое предложение</div>' +
        (o.project ? '<div class="sh-project">' + esc(o.project) + '</div>' : '') +
        '<div class="sh-clientRow">' +
        '<span class="sh-clientChip">Клиент</span>' +
        '<span class="sh-clientName">' + esc(c.name) + '</span>' +
        (c.contact ? '<span class="sh-clientContact">' + esc(c.contact) + '</span>' : '') +
        '</div>' +
        (s.intro ? '<div class="sh-intro">' + esc(s.intro) + '</div>' : '')
      );
    }

    function matRowHTML(key, label, val) {
      return '<div class="sh-matRow mk-' + key + '"><span class="sh-matK">' + label + '</span><span class="sh-matV">' + esc(val) + '</span></div>';
    }

    function productHTML(p) {
      var rows = '';
      PRODUCT_FIELDS.forEach(function (f) {
        if (p[f.key]) rows += matRowHTML(f.key, f.label, p[f.key]);
      });
      if (!rows && !p.title) return '';
      return '<div class="sh-mat">' + (p.title ? '<div class="sh-matTitle">' + esc(p.title) + '</div>' : '') + rows + '</div>';
    }

    function matsHTML(it) {
      var prods = (it.products || []).filter(function (p) {
        return p.title || p.outer || p.inner || p.hinges || p.drawers || p.lighting;
      });
      if (!prods.length) return '';
      return '<div class="sh-matHead">Материалы и исполнение</div>' +
        '<div class="sh-matList">' + prods.map(productHTML).join('') + '</div>';
    }

    function cardHTML(it, i, cur) {
      var img = it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<div class="sh-cardImg-ph">Фото</div>';
      var qty = qtyOf(it);
      var total = amountMinor(it.price) * qty / 100;
      return (
        '<div class="sh-card">' +
        '<div class="sh-cardImg">' + img + '</div>' +
        '<div class="sh-cardBody">' +
        '<div class="sh-cardIdx">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="sh-cardName">' + esc(it.name) + '</div>' +
        (it.description ? '<div class="sh-cardDesc">' + esc(it.description) + '</div>' : '') +
        matsHTML(it) +
        (it.note ? '<div class="sh-note"><span class="sh-noteLabel">Примечание</span><span class="sh-noteText">' + esc(it.note) + '</span></div>' : '') +
        '<div class="sh-cardFoot">' +
        (it.size ? '<div class="sh-cardSize"><span class="lbl">Длина × Высота × Глубина</span><span class="val">' + esc(it.size) + '</span></div>' : '') +
        (qty > 1 ? '<div class="sh-cardQty"><span class="lbl">Количество</span><span class="val">' + qty + ' шт × ' + fmt(it.price) + ' ' + cur + '</span></div>' : '') +
        '<div class="sh-cardPriceRow">' +
        '<span class="sh-cardUnit">' + (qty > 1 ? 'Стоимость за ' + qty + ' шт' : 'Стоимость') + '</span>' +
        '<span class="sh-cardTotal">' + fmt(total) + ' ' + cur + '</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    }

    function cardHTMLDbl(it, i, cur) {
      var img1 = it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<div class="sh-cardDblImg-ph">Фото 1</div>';
      var img2 = it.image2 ? '<img src="' + esc(it.image2) + '" alt="">' : '<div class="sh-cardDblImg-ph">Фото 2</div>';
      var qty = qtyOf(it);
      var total = amountMinor(it.price) * qty / 100;
      return (
        '<div class="sh-cardDbl">' +
        '<div class="sh-cardDblCol">' +
        '<div class="sh-cardDblImg">' + img1 + '</div>' +
        '<div class="sh-cardDblImg">' + img2 + '</div>' +
        '</div>' +
        '<div class="sh-cardBody">' +
        '<div class="sh-cardIdx">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="sh-cardName">' + esc(it.name) + '</div>' +
        (it.description ? '<div class="sh-cardDesc">' + esc(it.description) + '</div>' : '') +
        matsHTML(it) +
        (it.note ? '<div class="sh-note"><span class="sh-noteLabel">Примечание</span><span class="sh-noteText">' + esc(it.note) + '</span></div>' : '') +
        '<div class="sh-cardFoot">' +
        (it.size ? '<div class="sh-cardSize"><span class="lbl">Длина × Высота × Глубина</span><span class="val">' + esc(it.size) + '</span></div>' : '') +
        (qty > 1 ? '<div class="sh-cardQty"><span class="lbl">Количество</span><span class="val">' + qty + ' шт × ' + fmt(it.price) + ' ' + cur + '</span></div>' : '') +
        '<div class="sh-cardPriceRow">' +
        '<span class="sh-cardUnit">' + (qty > 1 ? 'Стоимость за ' + qty + ' шт' : 'Стоимость') + '</span>' +
        '<span class="sh-cardTotal">' + fmt(total) + ' ' + cur + '</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    }

    function deliveryHTML(s, cur) {
      var d = s.delivery || {};
      if (d.visible === false) return '';
      var amt = deliveryAmount(s);
      var rows = '';
      if (d.mode === 'items' && (d.items || []).length) {
        (d.items || []).forEach(function (it) {
          if (!it.name && !(+it.price)) return;
          rows += '<div class="sh-delRow"><span class="sh-delName">' + esc(it.name || '—') + '</span>' +
            '<span class="sh-delDots"></span><span class="sh-delPrice">' + fmt(it.price) + ' ' + cur + '</span></div>';
        });
      }
      if (amt <= 0 && !rows) return '';
      return (
        '<div class="sh-delivery">' +
        '<div class="sh-deliveryLeft">' +
        '<div class="sh-deliveryLabel">Доставка, выгрузка, монтаж</div>' +
        (rows ? '<div class="sh-deliveryRows">' + rows + '</div>' : '') +
        '</div>' +
        '<div class="sh-deliverySum">' + fmt(amt) + ' ' + cur + '</div>' +
        '</div>'
      );
    }

    function footBlockHTML(s, cur, T) {
      var m = s.manager || {}, o = s.order || {};
      var dl = discountLabel(T, cur);
      var note = s.totalNote || (dl ? 'скидка ' + dl + ' · доставка и монтаж включены' : 'включая доставку и монтаж');
      return (
        '<div class="sh-foot-block">' +
        deliveryHTML(s, cur) +
        '<div class="sh-total">' +
        '<div class="sh-totalFeather">' + LOGO + '</div>' +
        '<div class="sh-totalLeft">' +
        '<div class="sh-totalLabel">Итого к оплате</div>' +
        '<div class="sh-totalNote">' + note + '</div>' +
        (s.payment ? '<div class="sh-totalPay">' + esc(s.payment) + '</div>' : '') +
        '</div>' +
        '<div class="sh-totalRight">' +
        (T.disc > 0 ? '<div class="sh-totalSub">' + fmt(T.base) + ' ' + cur + '</div>' : '') +
        '<div class="sh-totalSum">' + fmt(T.total) + '<span class="sh-cur">' + cur + '</span></div>' +
        '</div>' +
        '</div>' +
        '<div class="sh-sign">' +
        '<div><div class="sh-signLabel">С уважением</div><div class="sh-signName">' + esc(m.name) + '</div>' +
        (m.role ? '<div class="sh-signRole">' + esc(m.role) + '</div>' : '') + '</div>' +
        '<div class="sh-valid">' +
        (m.phone ? '<div>' + esc(m.phone) + '</div>' : '') +
        (o.validUntil ? '<div>Предложение действительно до ' + esc(o.validUntil) + '</div>' : '') +
        '</div>' +
        '</div>' +
        (s.footer ? '<div class="sh-footer">' + linkify(s.footer) + '</div>' : '') +
        '</div>'
      );
    }

    function pageHTML(pg, s, cur, T) {
      var body = '';
      if (pg.cover) { body += coverHTML(s); }
      if (pg.items.length) {
        body += '<div class="page-items">';
        pg.items.forEach(function (it) {
          body += it.dbl
            ? cardHTMLDbl(it, s.items.indexOf(it), cur)
            : cardHTML(it, s.items.indexOf(it), cur);
        });
        body += '</div>';
      }
      if (pg.footer) { body += footBlockHTML(s, cur, T); }
      return '<section class="page"><div class="sh-bar"></div><div class="page-body">' + body + '</div></section>';
    }

    function sheetHTML(s) {
      var cur = s.currency || '$';
      var T = totalsOf(s);
      return buildPages(s).map(function (pg) { return pageHTML(pg, s, cur, T); }).join('');
    }

    function buildFullHTML(state) {
      return '<!DOCTYPE html>' +
      '<html lang="ru"><head><meta charset="UTF-8">' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;600;700' +
        '&family=JetBrains+Mono:wght@400;500;700&family=Spectral:wght@500;600&display=swap" rel="stylesheet">' +
      '<style>' +

      '*{box-sizing:border-box;margin:0;padding:0}' +
      'html,body{width:210mm}' +
      'body{font-family:"Manrope",system-ui,sans-serif;color:#182430;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '@page{size:A4;margin:0}' +

      '.sheet{display:block}' +
      '.page{width:210mm;height:297mm;box-sizing:border-box;background:#fff;color:#182430;position:relative;overflow:hidden;' +
        'display:flex;flex-direction:column;break-after:page;page-break-after:always}' +
      '.page:last-child{break-after:auto;page-break-after:auto}' +
      '.sh-bar{height:1.8mm;background:#0A0A0A;flex:none}' +
      '.page-body{flex:1;min-height:0;padding:8mm 12mm 9mm;display:flex;flex-direction:column}' +

      '.sh-covTop{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;flex:none}' +
      '.sh-brandCol{display:flex;gap:4.5mm;align-items:center}' +
      '.sh-logo{width:19mm;height:19mm;color:#0A0A0A;flex:none}' +
      '.sh-logo svg{width:100%;height:100%}' +
      '.sh-company{font-family:"Spectral",Georgia,serif;font-size:19pt;font-weight:600;letter-spacing:.02em;line-height:1.15}' +
      '.sh-tagline{font-family:"JetBrains Mono",monospace;font-size:7.5pt;letter-spacing:.05em;color:#6E6E6A;margin-top:2mm;line-height:1.55;max-width:74mm}' +
      '.sh-covRight{flex:none;text-align:left}' +
      '.sh-contacts{font-family:"JetBrains Mono",monospace;font-size:8.5pt;line-height:1.8;color:#5B5B57;text-align:left}' +
      '.sh-contacts a{color:inherit;text-decoration:none}' +
      '.sh-contacts a:hover{text-decoration:underline}' +
      '.sh-messRow{display:inline-flex;gap:1.6mm;margin-left:2mm;vertical-align:middle}' +
      '.sh-mess{display:inline-flex;text-decoration:none}' +
      '.sh-messDot{width:4.4mm;height:4.4mm;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}' +
      '.sh-messDot svg{width:2.6mm;height:2.6mm}' +
      '.sh-messDot.wa{background:#25D366}' +
      '.sh-messDot.tg{background:#229ED9}' +
      '.sh-messDot.vb{background:#7360F2}' +
      '.sh-messDot.ig{background:#E1306C}' +
      '.sh-kicker{font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:#0A0A0A;margin-top:7mm}' +
      '.sh-title{font-size:26pt;font-weight:200;line-height:1.05;letter-spacing:-.015em;margin-top:2mm}' +
      '.sh-project{font-size:12pt;font-weight:300;color:#6E6E6A;margin-top:2mm}' +
      '.sh-clientRow{display:flex;align-items:center;gap:3.5mm;margin-top:4mm;flex-wrap:wrap}' +
      '.sh-clientChip{font-family:"JetBrains Mono",monospace;font-size:7pt;letter-spacing:.14em;color:#0A0A0A;border:.35mm solid #0A0A0A;border-radius:99mm;padding:1.3mm 3.2mm}' +
      '.sh-clientName{font-size:12pt;font-weight:600}' +
      '.sh-clientContact{font-family:"JetBrains Mono",monospace;font-size:9pt;color:#9C9C98}' +
      '.sh-intro{font-size:10pt;line-height:1.6;color:#6E6E6A;margin-top:3.5mm;max-width:160mm}' +
      '.sh-coverSec{margin-top:7mm;border-top:.3mm solid #E7E7E4;padding-top:5mm}' +
      '.sh-coverLabel{font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#9C9C98;margin-bottom:2.5mm}' +
      '.sh-coverText{font-size:9.5pt;line-height:1.6;color:#3A3A38;max-width:168mm}' +
      '.sh-coverText+.sh-coverText{margin-top:2.5mm}' +
      '.sh-adv{margin:0;padding:0;list-style:none;columns:2;column-gap:8mm}' +
      '.sh-adv li{position:relative;padding-left:5mm;font-size:9.5pt;line-height:1.55;color:#3A3A38;margin-bottom:1.6mm;break-inside:avoid}' +
      '.sh-adv li:before{content:"";position:absolute;left:0;top:2mm;width:1.6mm;height:1.6mm;background:#0A0A0A}' +
      '.sh-coverReq{font-family:"JetBrains Mono",monospace;font-size:7pt;line-height:1.7;color:#6E6E6A;margin-bottom:3mm}' +

      '.page-items{flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:5mm;margin-top:5mm}' +
      '.sh-card{flex:1 1 0;min-height:0;display:flex;background:#fff;border:.35mm solid #E7E7E4;border-radius:3mm;overflow:hidden}' +
      '.sh-cardImg{width:88mm;flex:none;background:#F7F7F5;min-height:0;display:flex;align-items:center;justify-content:center}' +
      '.sh-cardImg img{width:100%;height:100%;object-fit:contain;display:block}' +
      '.sh-cardImg-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
        'font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:#B4B4B0}' +
      '.sh-cardDbl{flex:1 1 0;min-height:0;display:flex;background:#fff;border:.35mm solid #E7E7E4;border-radius:3mm;overflow:hidden}' +
      '.sh-cardDblCol{width:88mm;flex:none;background:#F7F7F5;min-height:0;display:flex;flex-direction:column;gap:2.5mm}' +
      '.sh-cardDblImg{flex:1 1 0;min-height:0;display:flex;align-items:center;justify-content:center}' +
      '.sh-cardDblImg img{width:100%;height:100%;object-fit:contain;display:block}' +
      '.sh-cardDblImg-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
        'font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:#B4B4B0}' +
      '.sh-cardBody{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;padding:5.5mm 6.5mm 5mm;overflow:hidden}' +
      '.sh-cardIdx{font-family:"JetBrains Mono",monospace;font-size:6.5pt;letter-spacing:.2em;color:#9C9C98;flex:none}' +
      '.sh-cardName{font-size:13.5pt;font-weight:700;line-height:1.15;margin-top:1.5mm;color:#0A0A0A;flex:none}' +
      '.sh-cardDesc{font-size:8pt;color:#555;line-height:1.5;margin-top:2mm}' +

      '.sh-matHead{font-family:"JetBrains Mono",monospace;font-size:6.3pt;letter-spacing:.2em;text-transform:uppercase;color:#0A0A0A;' +
        'border-bottom:.4mm solid #0A0A0A;padding-bottom:1.2mm;margin-top:3mm;flex:none}' +
      '.sh-matList{margin-top:2.2mm;display:flex;flex-direction:column;gap:2.2mm}' +
      '.sh-matTitle{font-size:8.5pt;font-weight:700;color:#0A0A0A;margin-bottom:1mm}' +
      '.sh-matRow{display:flex;gap:2.5mm;align-items:baseline;border-left:.7mm solid #9C9C98;padding-left:2.2mm;margin-top:1.1mm}' +
      '.sh-matK{font-family:"JetBrains Mono",monospace;font-size:5.8pt;letter-spacing:.06em;text-transform:uppercase;color:#9C9C98;flex:none;min-width:26mm}' +
      '.sh-matV{font-size:7.3pt;color:#3A3A38;line-height:1.45}' +
      '.mk-outer{border-color:#0A0A0A}' +
      '.mk-inner{border-color:#8A8A86}' +
      '.mk-hinges{border-color:#D9822B}' +
      '.mk-drawers{border-color:#8A6D3B}' +
      '.mk-lighting{border-color:#C2410C}' +

      '.sh-note{position:relative;background:#FBF1E3;border:.3mm solid #EBC9A0;border-left:1.1mm solid #D9822B;border-radius:2mm;padding:2.4mm 3mm;margin-top:3mm;flex:none}' +
      '.sh-noteLabel{display:block;font-family:"JetBrains Mono",monospace;font-size:5.8pt;letter-spacing:.18em;text-transform:uppercase;color:#C2410C;margin-bottom:1mm}' +
      '.sh-noteText{font-size:7.8pt;color:#7A4A12;line-height:1.5}' +

      '.sh-cardFoot{margin-top:auto;padding-top:2.5mm;flex:none}' +
      '.sh-cardSize,.sh-cardQty{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;border-top:.3mm solid #E7E7E4;padding-top:2.2mm;margin-bottom:1.8mm}' +
      '.sh-cardSize .lbl,.sh-cardQty .lbl{font-family:"JetBrains Mono",monospace;font-size:6pt;letter-spacing:.14em;text-transform:uppercase;color:#9C9C98;flex:none}' +
      '.sh-cardSize .val,.sh-cardQty .val{font-family:"JetBrains Mono",monospace;font-size:8pt;color:#0A0A0A;text-align:right}' +
      '.sh-cardPriceRow{display:flex;justify-content:space-between;align-items:baseline}' +
      '.sh-cardUnit{font-family:"JetBrains Mono",monospace;font-size:6pt;letter-spacing:.14em;text-transform:uppercase;color:#9C9C98}' +
      '.sh-cardTotal{font-size:15pt;font-weight:700;color:#0A0A0A}' +

      '.sh-delivery{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;' +
        'background:#FFFFFF;border:.3mm solid #E7E7E4;border-left:1.3mm solid #D9822B;border-radius:3mm;' +
        'padding:4.5mm 6mm;margin-bottom:5mm;flex:none}' +
      '.sh-deliveryLeft{flex:1;min-width:0}' +
      '.sh-deliveryLabel{font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#C2410C;font-weight:700}' +
      '.sh-deliveryRows{margin-top:2.6mm;display:flex;flex-direction:column;gap:1.7mm}' +
      '.sh-delRow{display:flex;align-items:baseline;gap:2.5mm}' +
      '.sh-delName{font-size:9.5pt;color:#3A3A38;flex:none}' +
      '.sh-delDots{flex:1;border-bottom:.35mm dotted #C9C9C5;transform:translateY(-1.2mm)}' +
      '.sh-delPrice{font-family:"JetBrains Mono",monospace;font-size:9pt;font-weight:500;color:#0A0A0A;flex:none}' +
      '.sh-deliverySum{flex:none;text-align:right;font-size:15pt;font-weight:700;color:#0A0A0A;padding-top:.5mm;font-variant-numeric:tabular-nums}' +

      '.sh-foot-block{margin-top:auto;flex:none;padding-top:5mm}' +
      '.sh-total{background:#F4F4F2;border:.3mm solid #E7E7E4;border-radius:3mm;padding:5mm 6mm;' +
        'display:flex;justify-content:space-between;align-items:center;position:relative;overflow:hidden;gap:6mm}' +
      '.sh-totalFeather{position:absolute;right:3mm;top:50%;transform:translateY(-50%);width:20mm;height:20mm;color:#0A0A0A;opacity:.035}' +
      '.sh-totalFeather svg{width:100%;height:100%}' +
      '.sh-totalLeft{position:relative}' +
      '.sh-totalLabel{font-family:"JetBrains Mono",monospace;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#0A0A0A;font-weight:700}' +
      '.sh-totalNote{font-size:9pt;color:#6E6E6A;margin-top:1.6mm}' +
      '.sh-totalPay{font-size:7.8pt;color:#6E6E6A;margin-top:1.6mm;line-height:1.45}' +
      '.sh-totalRight{text-align:right;position:relative}' +
      '.sh-totalSub{font-family:"JetBrains Mono",monospace;font-size:8.5pt;color:#9C9C98;text-decoration:line-through;margin-bottom:1mm}' +
      '.sh-totalSum{font-size:24pt;font-weight:200;letter-spacing:-.01em}' +
      '.sh-cur{font-size:11pt;font-weight:300;color:#6E6E6A;margin-left:1.2mm}' +
      '.sh-sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:6mm}' +
      '.sh-signLabel{font-family:"JetBrains Mono",monospace;font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;color:#9C9C98}' +
      '.sh-signName{font-size:11.5pt;font-weight:600;margin-top:1.2mm}' +
      '.sh-signRole{font-size:9pt;color:#6E6E6A;margin-top:.7mm}' +
      '.sh-valid{font-family:"JetBrains Mono",monospace;font-size:8.5pt;color:#9C9C98;text-align:right;line-height:1.8}' +
      '.sh-footer{margin-top:6mm;padding-top:3.5mm;border-top:.3mm solid #E3ECF3;font-family:"JetBrains Mono",monospace;font-size:8pt;line-height:1.75;color:#9C9C98}' +
      '.sh-footer a{color:inherit;text-decoration:none}' +

      '</style></head><body>' +
      '<article class="sheet">' + sheetHTML(state) + '</article>' +
      '</body></html>';
    }

    return {
        buildFullHTML: buildFullHTML,
        sheetHTML: sheetHTML,
        totalsOf: totalsOf,
        qtyOf: qtyOf,
        deliveryAmount: deliveryAmount,
        subtotalOf: subtotalOf,
        discountLabel: discountLabel,
        esc: esc,
        fmt: fmt,
        digits: digits,
        webHref: webHref,
        linkify: linkify,
        toLatin: toLatin,
        pdfFileName: pdfFileName,
        normalizeState: normalizeState,
        LOGO: LOGO,
        PRODUCT_FIELDS: PRODUCT_FIELDS
    };
}));
