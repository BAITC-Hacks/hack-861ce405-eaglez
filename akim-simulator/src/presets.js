'use strict';
const example = [['M7', 'Нура'], ['M8', 'Нура'], ['M10', 'Нура'], ['M12', null], ['M5', 'Сарыарка']].map(([id, district]) => ({ id, district }));
const cheap = [['M9', 'Нура'], ['M11', 'Нура'], ['M10', 'Нура'], ['M12', null], ['M4', 'Сарыарка']].map(([id, district]) => ({ id, district }));
module.exports = { example, cheap };
