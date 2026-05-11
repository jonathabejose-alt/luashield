(function () {
  'use strict';

  /**
   * Lua parser básico (sin dependencias)
   * - No es un parser completo: genera un AST muy limitado basado en heurísticas.
   * - Diseñado para permitir generateCode(ast) y validar de forma ligera.
   */

  function parseLua(code) {
    code = String(code ?? '');

    // Heurística de validación: balances de long strings [[...]] y strings "..." / '...' y comentarios.
    // Si hay demasiados desbalances obvios, marcamos error.
    try {
      var state = scanLuaState(code);
      if (state.unclosedLongString) {
        return { success: false, error: 'Unclosed long string', errorDetails: { message: 'Unclosed long string' } };
      }
      if (state.unclosedString) {
        return { success: false, error: 'Unclosed string literal', errorDetails: { message: 'Unclosed string literal' } };
      }

      // AST heurístico: lista de sentencias top-level por líneas (minimiza riesgo de romper generator).
      // Chunk.body = array de nodos con tipo 'RawStatement' para round-trip.
      var lines = code.split(/\r?\n/);
      var body = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || !line.trim()) continue;
        // Ignorar comentarios puros
        if (stripLineComments(line).trim().length === 0) continue;
        body.push({ type: 'RawStatement', raw: line });
      }

      return { success: true, ast: { type: 'Chunk', body: body } };
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : 'Failed to parse Lua', errorDetails: { message: e && e.message ? e.message : 'Failed to parse Lua' } };
    }
  }

  function scanLuaState(code) {
    var i = 0;
    var n = code.length;
    var inShortString = false;
    var shortQuote = null;
    var inLongString = false;
    var longClose = ']]';
    var unclosedString = false;
    var unclosedLongString = false;

    // track backslash escapes in short strings
    while (i < n) {
      var ch = code[i];
      var next = i + 1 < n ? code[i + 1] : '';

      // Long string mode
      if (inLongString) {
        var idx = code.indexOf(longClose, i);
        if (idx === -1) {
          unclosedLongString = true;
          break;
        }
        i = idx + longClose.length;
        inLongString = false;
        continue;
      }

      // Short string mode
      if (inShortString) {
        if (ch === '\\') {
          i += 2; // skip escaped char
          continue;
        }
        if (ch === shortQuote) {
          inShortString = false;
          shortQuote = null;
          i++;
          continue;
        }
        i++;
        continue;
      }

      // Comments
      if (ch === '-' && next === '-') {
        // long comment --[[ ... ]]
        var after = i + 2;
        if (code[after] === '[' && code[after + 1] === '[') {
          // skip comment long string
          var closeIdx = code.indexOf(']]', after + 2);
          if (closeIdx === -1) {
            unclosedLongString = true;
            break;
          }
          i = closeIdx + 2;
          continue;
        }
        // single-line comment
        var nl = code.indexOf('\n', i);
        if (nl === -1) break;
        i = nl + 1;
        continue;
      }

      // Long string start [[
      if (ch === '[' && next === '[') {
        inLongString = true;
        longClose = ']]';
        i += 2;
        continue;
      }

      // Short string start
      if (ch === '"' || ch === "'") {
        inShortString = true;
        shortQuote = ch;
        i++;
        continue;
      }

      i++;
    }

    if (inShortString) unclosedString = true;

    return { unclosedString: unclosedString, unclosedLongString: unclosedLongString };
  }

  /**
   * Generator: convierte AST heurístico a código
   */
  function generateCode(ast) {
    if (!ast || ast.type !== 'Chunk' || !Array.isArray(ast.body)) return '';
    return ast.body.map(function (n) {
      if (!n) return '';
      if (n.type === 'RawStatement') return n.raw;
      return '';
    }).filter(Boolean).join('\n');
  }

  /**
   * Helpers Lua-obfuscation (string/number encoding + minify + name mangling + dead code + anti-debug + control flow)
   */

  var DEFAULT_OPTIONS = {
    mangleNames: true,
    encodeStrings: false,
    encodeNumbers: false,
    controlFlow: false,
    minify: true,
    protectionLevel: 50,
    antiDebugging: true,
    deadCodeInjection: true,
    encryptionAlgorithm: 'xor', // xor | none
    formattingStyle: null,
    indentChar: 'space',
    indentSize: 2
  };

  function obfuscateLuaCode(code, options) {
    var opt = mergeOptions(options);
    code = String(code ?? '');

    var parsed = parseLua(code);
    if (!parsed.success) {
      return { success: false, error: parsed.error || 'Invalid Lua syntax', errorDetails: parsed.errorDetails };
    }

    var protectionLevel = clampNumber(opt.protectionLevel, 0, 100);

    var out = code;

    // Anti-debugging (debug library & info check)
    if (opt.antiDebugging && protectionLevel >= 40) {
      out = injectAntiDebug(out, protectionLevel);
    }

    // Dead code realista
    if (opt.deadCodeInjection && protectionLevel >= 25) {
      out = injectDeadCode(out, protectionLevel);
    }

    // Number encoding
    if (opt.encodeNumbers) {
      out = encodeNumbers(out, protectionLevel);
    }

    // Control flow flattening / opaque predicates
    if (opt.controlFlow && protectionLevel >= 70) {
      out = controlFlowFlattening(out, protectionLevel);
    }

    // String encoding XOR rotating key
    if (opt.encodeStrings) {
      out = encodeStringsXOR(out, protectionLevel);
    }

    // Name mangling
    if (opt.mangleNames) {
      out = mangleNames(out);
    }

    // Minification
    if (opt.minify) {
      out = minifyLua(out);
    }

    return { success: true, code: out };
  }

  function mergeOptions(user) {
    user = user || {};
    var opt = {};
    for (var k in DEFAULT_OPTIONS) opt[k] = DEFAULT_OPTIONS[k];
    for (var u in user) opt[u] = user[u];

    // Map protección a switches por defecto
    var p = opt.protectionLevel ?? 50;
    if (user.mangleNames == null) opt.mangleNames = p >= 20;
    if (user.encodeStrings == null) opt.encodeStrings = p >= 40;
    if (user.encodeNumbers == null) opt.encodeNumbers = p >= 60;
    if (user.controlFlow == null) opt.controlFlow = p >= 80;
    if (user.minify == null) opt.minify = p >= 10;
    if (user.antiDebugging == null) opt.antiDebugging = true;
    if (user.deadCodeInjection == null) opt.deadCodeInjection = true;

    return opt;
  }

  function clampNumber(n, a, b) {
    n = Number(n);
    if (isNaN(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  function stripLineComments(line) {
    // elimina --... fuera de strings simples
    var s = line;
    var inStr = false;
    var q = '';
    for (var i = 0; i < s.length - 1; i++) {
      var ch = s[i];
      var next = s[i + 1];

      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === q) { inStr = false; q = ''; }
        continue;
      }

      if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
      if (ch === '-' && next === '-') {
        return s.slice(0, i);
      }
    }
    return s;
  }

  // ---------------- Name Mangling ----------------
  function mangleNames(code) {
    var protectedNames = makeProtectedNames();
    var identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    var identifiers = new Set();
    var match;

    while ((match = identifierPattern.exec(code)) !== null) {
      var name = match[1];
      if (!protectedNames.has(name)) identifiers.add(name);
    }

    var nameMap = new Map();
    var counter = 0;
    identifiers.forEach(function (name) {
      if (!nameMap.has(name)) {
        var hex = (counter++).toString(16).padStart(4, '0');
        nameMap.set(name, '_0x' + hex);
      }
    });

    var result = code;
    nameMap.forEach(function (mangled, original) {
      var re = new RegExp('\\b' + escapeRegExp(original) + '\\b', 'g');
      result = result.replace(re, mangled);
    });

    return result;
  }

  function makeProtectedNames() {
    return new Set([
      'and','break','do','else','elseif','end','false','for','function','if','in','local','nil','not','or','repeat','return','then','true','until','while',
      'print','require','pairs','ipairs','tonumber','tostring','type','next','select','assert','error','pcall','xpcall','setmetatable','getmetatable','rawget','rawset','rawequal',
      'math','string','table','io','os','debug','coroutine',
      'char','byte','find','format','gmatch','gsub','len','lower','match','rep','reverse','sub','upper',
      'insert','remove','sort','concat',
      'abs','acos','asin','atan','ceil','cos','deg','exp','floor','fmod','log','max','min','modf','pi','pow','rad','random','randomseed','sin','sqrt','tan'
    ]);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---------------- Number Encoding ----------------
  function encodeNumbers(code, protectionLevel) {
    // Nota: lookbehind no siempre está soportado. Usamos heurística sin lookbehind.
    // Pattern: números con boundary aproximada.
    var re = /(^|[^A-Za-z0-9_])(\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g;

    var encodedCount = 0;

    return code.replace(re, function (full, prefix, numStr) {
      var num = parseFloat(numStr);
      if (num >= 0 && num <= 3) return prefix + numStr;

      var should = shouldByProtection(protectionLevel);
      if (!should) return prefix + numStr;

      encodedCount++;
      var strategy = Math.floor(Math.random() * 3);

      if (strategy === 0) {
        var half = Math.floor(num / 2);
        var remainder = num - half;
        return prefix + '(' + half + ' + ' + remainder + ')';
      }
      if (strategy === 1) {
        var multiplier = 2 + Math.floor(Math.random() * 3);
        return prefix + '(' + (num * multiplier) + ' / ' + multiplier + ')';
      }

      // strategy 2
      if (Number.isInteger(num)) {
        var offset = 10 + Math.floor(Math.random() * 90);
        return prefix + '(' + (num + offset) + ' - ' + offset + ')';
      }

      var m = Math.pow(10, 1 + Math.floor(Math.random() * 2));
      return prefix + '(' + (num * m) + ' / ' + m + ')';
    });

    function shouldByProtection(p) {
      if (p >= 100) return true;
      if (p <= 0) return false;
      return Math.random() * 100 < p;
    }
  }

  // ---------------- String Encoding XOR rotating key ----------------
  function encodeStringsXOR(code, protectionLevel) {
    // Regex aproximado para strings simples/dobles con escapes
    var strRe = /(["'])(?:(?=(\\?))\2.)*?\1/g;

    var key = Math.floor(Math.random() * 254) + 1; // 1-255

    // Lua decryptor inline (devuelto por cada string)
    // Usamos una función que decodifica un array de bytes.
    function decryptorLua() {
      return '(function(t,k)local s=""for i=1,#t do s=s..string.char(t[i]~(((k+i-1)%255)+1))end return s end)';
    }

    var should = shouldByProtection(protectionLevel);
    // no: cada string decide

    return code.replace(strRe, function (match) {
      var content = match.slice(1, -1);
      if (!content || content.length === 0) return match;

      if (!shouldByProtection(protectionLevel)) return match;

      var bytes = [];
      for (var i = 0; i < content.length; i++) {
        var charCode = content.charCodeAt(i);
        var rotatedKey = ((key + i) % 255) + 1;
        bytes.push(charCode ^ rotatedKey);
      }

      // Decodifica a runtime
      return decryptorLua() + '({' + bytes.join(',') + '},' + key + ')';
    });

    function shouldByProtection(p) {
      if (p >= 100) return true;
      if (p <= 0) return false;
      return Math.random() * 100 < p;
    }
  }

  // ---------------- Dead Code ----------------
  function injectDeadCode(code, protectionLevel) {
    var lines = code.split(/\r?\n/);
    var res = [];

    var rate = Math.min(80, Math.max(5, protectionLevel / 1.5));

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      res.push(line);
      var trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--')) continue;

      if (Math.random() * 100 < rate) {
        res.push(generateUnreachableBlock());
      }
    }

    return res.join('\n');
  }

  function generateUnreachableBlock() {
    var condition = generateFalseCondition();
    var blockType = Math.floor(Math.random() * 4);
    var block = '';

    if (blockType === 0) block = generateDummyLoop();
    else if (blockType === 1) block = generateDummyTable();
    else if (blockType === 2) block = generateDummyConditional();
    else block = generateUnusedFunction();

    return 'if ' + condition + ' then\n  ' + block.replace(/\n/g, '\n  ') + '\nend';
  }

  function generateFalseCondition() {
    var conditions = ['1 > 2','false','0 == 1','nil and true','10 < 5',"'a' == 'b'",'not true','5 + 5 == 11'];
    return conditions[Math.floor(Math.random() * conditions.length)];
  }

  function generateRandomVar() {
    var prefixes = ['tmp','var','val','data','result','cache','buffer'];
    var prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    var suffix = Math.floor(Math.random() * 10000);
    return '_' + prefix + '_' + suffix;
  }

  function generateRandomNumber() {
    return Math.floor(Math.random() * 1000);
  }

  function generateDummyLoop() {
    var v = generateRandomVar();
    var iterations = Math.floor(Math.random() * 10) + 1;
    var op = generateDummyMathOperation(v);
    return 'for ' + v + ' = 1, ' + iterations + ' do\n  ' + op + '\nend';
  }

  function generateDummyMathOperation(varName) {
    var ops = [
      varName + ' = ' + varName + ' + ' + generateRandomNumber(),
      varName + ' = ' + varName + ' * 2',
      varName + ' = ' + varName + ' - ' + generateRandomNumber(),
      varName + ' = math.abs(' + varName + ')',
      varName + ' = math.floor(' + varName + ' / 2)',
      varName + ' = ' + varName + ' % 100'
    ];
    return ops[Math.floor(Math.random() * ops.length)];
  }

  function generateDummyTable() {
    var t = generateRandomVar();
    var type = Math.floor(Math.random() * 3);
    if (type === 0) {
      var n = generateRandomNumber();
      return 'local ' + t + ' = {}\nfor i = 1, ' + n + ' do\n  ' + t + '[i] = i * 2\nend';
    }
    if (type === 1) {
      return 'local ' + t + ' = {' + generateRandomNumber() + ',' + generateRandomNumber() + ',' + generateRandomNumber() + '}\ntable.insert(' + t + ', ' + generateRandomNumber() + ')';
    }
    return 'local ' + t + ' = {}\n' + t + '.x = ' + generateRandomNumber() + '\n' + t + '.y = ' + generateRandomNumber();
  }

  function generateDummyConditional() {
    var v = generateRandomVar();
    var value = generateRandomNumber();
    return 'local ' + v + ' = ' + value + '\nif ' + v + ' > ' + (value + 100) + ' then\n  ' + generateDummyMathOperation(v) + '\nelseif ' + v + ' < ' + (value - 100) + ' then\n  ' + v + ' = 0\nend';
  }

  function generateUnusedFunction() {
    var funcName = generateRandomVar();
    var p1 = generateRandomVar();
    var p2 = generateRandomVar();
    var localVar = generateRandomVar();

    var templates = [
      'local function ' + funcName + '(' + p1 + ', ' + p2 + ')\n  local ' + localVar + ' = ' + p1 + ' + ' + p2 + '\n  ' + generateDummyMathOperation(localVar) + '\n  return ' + localVar + '\nend',
      'local function ' + funcName + '(' + p1 + ')\n  if ' + p1 + ' > 0 then\n    return ' + p1 + ' * 2\n  else\n    return 0\n  end\nend',
      'local function ' + funcName + '()\n  local ' + localVar + ' = ' + generateRandomNumber() + '\n  for i = 1, 10 do\n    ' + localVar + ' = ' + localVar + ' + i\n  end\n  return ' + localVar + '\nend'
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ---------------- Anti-Debugging ----------------
  function injectAntiDebug(code, protectionLevel) {
    // requerimiento: "debug.info check"
    // No todos los entornos Lua tienen debug.info, así que verificamos.
    var freq = Math.min(90, Math.max(20, protectionLevel));

    var anti = generateAntiDebugFunctionLua();

    // insert at top
    var parts = code.split(/\r?\n/);
    var inserted = false;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t === '' || t.startsWith('--')) continue;
      parts.splice(i, 0, anti, '');
      inserted = true;
      break;
    }
    if (!inserted) parts.push(anti);

    // sprinkle inline checks
    for (var j = 0; j < parts.length; j++) {
      var ln = parts[j];
      var tr = ln.trim();
      if (!tr || tr.startsWith('--')) continue;
      if (Math.random() * 100 < freq * 0.25) {
        parts.splice(j + 1, 0, '(_ad_chk and _ad_chk() or nil)');
        j++;
      }
    }

    return parts.join('\n');
  }

  function generateAntiDebugFunctionLua() {
    // checks: debug, debug.info, stack/traceback if present
    // Además: entorno global sospechoso.
    return [
      'do',
      '  local _ad_seed = math.floor((os.clock and os.clock() or 0) * 1000) % 100000',
      '  local function _ad_fail(msg)',
      '    error(msg, 0)',
      '  end',
      '  function _ad_chk()',
      '    -- debug library available?',
      '    if type(debug) == "table" then',
      '      if debug.info then',
      '        -- debug.info check (requiere debug.info)',

      '        local ok, res = pcall(debug.info, 1)',
      '        if ok and res then _ad_fail("debug.info detected") end',
      '      end',
      '      if debug.traceback then',
      '        local tb = debug.traceback() or ""',
      '        if #tb > 10000 then _ad_fail("debug.traceback anomaly") end',
      '      end',
      '    end',
      '    if _G and (_G._DEBUG or _G._TRACE or _G._HOOK) then',
      '      _ad_fail("debug environment detected")',
      '    end',
      '    if type(print) ~= "function" then _ad_fail("modified environment") end',
      '  end',
      '  _ad_chk()',
      'end',
    ].join('\n');
  }

  // ---------------- Control Flow Flattening ----------------
  function controlFlowFlattening(code, protectionLevel) {
    // Heurística: agrega predicados opacos a if/while/repeat.
    // Aunque no es flattening de CFG real, cumple el objetivo práctico de ofuscar el flujo.
    var should = true;

    var opaquePredicates = [
      '(1 + 1 == 2)',
      '(2 * 3 > 5)',
      '(true or false)',
      '(5 == 5)',
      '(math.abs(-1) == 1)'
    ];

    var opaqueIf = function (cond) {
      var op = opaquePredicates[Math.floor(Math.random() * opaquePredicates.length)];
      return 'if ' + op + ' and (' + cond + ') then';
    };

    // if ... then
    code = code.replace(/\bif\s+(.+?)\s+then\b/g, function (m, cond) {
      if (Math.random() * 100 > protectionLevel) return m;
      return opaqueIf(cond);
    });

    // while ... do
    var whileOpaque = function (cond) {
      return 'while (1 * 1 >= 0) and (' + cond + ') do';
    };
    code = code.replace(/\bwhile\s+(.+?)\s+do\b/g, function (m, cond) {
      if (Math.random() * 100 > protectionLevel) return m;
      return whileOpaque(cond);
    });

    // until ... (hasta fin de línea)
    code = code.replace(/\buntil\s+(.+?)(?=\n|$)/g, function (m, cond) {
      if (Math.random() * 100 > protectionLevel) return m;
      return 'until (1 == 1) and (' + cond + ')';
    });

    return code;
  }

  // ---------------- Minify ----------------
  function minifyLua(code) {
    // Eliminar comentarios (heurístico) + espacios
    var lines = code.split(/\r?\n/);
    var out = [];

    var inMultiline = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line;

      if (inMultiline) {
        var endIdx = t.indexOf(']]');
        if (endIdx === -1) continue;
        t = t.slice(endIdx + 2);
        inMultiline = false;
      }

      // start multiline comment
      var startIdx = t.indexOf('--[[');
      while (startIdx !== -1) {
        var closeIdx = t.indexOf(']]', startIdx + 4);
        if (closeIdx === -1) {
          // comment continues; remove tail
          t = t.slice(0, startIdx);
          inMultiline = true;
          break;
        }
        t = t.slice(0, startIdx) + t.slice(closeIdx + 2);
        startIdx = t.indexOf('--[[');
      }

      // remove single line comments outside strings
      t = stripLineComments(t);
      t = t.replace(/[ \t]+/g, ' ');
      if (t.trim().length === 0) continue;
      out.push(t.trim());
    }

    return out.join('\n').trim();
  }

  // Expose API
  window.obfuscateLuaCode = obfuscateLuaCode;
  window.generateCode = generateCode;
  window.parseLua = parseLua;

})();

