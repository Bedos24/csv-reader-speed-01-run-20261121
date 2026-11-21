// A faster drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns exactly csv-reader's answer for every input {text, header}: the JSON value
// {columns, rows, errors} produced by its written broken-row policy —
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is
//     one quote; each CRLF or lone CR inside it is read as LF); what follows its closing quote, up
//     to the next comma or line break, is appended as it stands (error quote_junk when the field
//     ends); a quote that never closes is a literal character and the text after it is read again
//     as unquoted (error unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row, with fields: its field
//     count) or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line its record starts
//     on (counting every LF, CRLF and lone CR inside quotes), row its record's index in rows,
//     null for the header.
//
// Where the reference walks one character at a time and builds each field a character at a time,
// this reader finds each field's end with indexOf and takes the field as one slice of the text
// whenever it holds nothing that needs rewriting; only fields that actually contain a stray CR,
// a CR inside quotes, or a doubled quote pay for a segmented rebuild. Pure: nothing is kept
// from one call to the next.

// How a field ended.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recLine = 1;
  let recRow = null;

  // scanUnquoted's results, returned through these instead of a fresh object per field.
  let uValue = '';
  let uEnded = END;
  let uPos = 0;
  let uAdded = 0;

  // Reads unquoted characters starting at p: up to the next comma or line break, dropping each
  // CR that is not followed by LF (stray_cr). Sets uValue (the field's text), uEnded, uPos (the
  // position after the terminator) and uAdded (the characters kept). A line break that ends the
  // field is the caller's to count, exactly when uEnded is LINE_BREAK.
  function scanUnquoted(p) {
    let i = p;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 10) {
        // ',' or LF
        uValue = text.slice(p, i);
        uAdded = i - p;
        uEnded = c === 44 ? COMMA : LINE_BREAK;
        uPos = i + 1;
        return;
      }
      if (c === 13) {
        // CR: CRLF ends the field; a lone CR is dropped and the slow path takes over.
        if (text.charCodeAt(i + 1) === 10) {
          uValue = text.slice(p, i);
          uAdded = i - p;
          uEnded = LINE_BREAK;
          uPos = i + 2;
          return;
        }
        break;
      }
      i += 1;
    }
    if (i >= n) {
      uValue = text.slice(p, n);
      uAdded = n - p;
      uEnded = END;
      uPos = n;
      return;
    }
    // Slow path: a lone CR at i. Build the field from the slices between dropped CRs.
    const parts = [text.slice(p, i)];
    let added = i - p;
    let seg = i + 1;
    errors.push({ code: 'stray_cr', line: recLine, row: recRow });
    i += 1;
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10) {
          parts.push(text.slice(seg, i));
          uValue = parts.join('');
          uAdded = added + (i - seg);
          uEnded = c === 44 ? COMMA : LINE_BREAK;
          uPos = i + 1;
          return;
        }
        if (c === 13) {
          if (text.charCodeAt(i + 1) === 10) {
            parts.push(text.slice(seg, i));
            uValue = parts.join('');
            uAdded = added + (i - seg);
            uEnded = LINE_BREAK;
            uPos = i + 2;
            return;
          }
          break;
        }
        i += 1;
      }
      if (i >= n) {
        parts.push(text.slice(seg, n));
        uValue = parts.join('');
        uAdded = added + (n - seg);
        uEnded = END;
        uPos = n;
        return;
      }
      parts.push(text.slice(seg, i));
      added += i - seg;
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      i += 1;
      seg = i;
    }
  }

  // Rewrites a quoted field's raw content (the text between its quotes) as csv-reader reads it:
  // each CRLF or lone CR becomes LF (and counts as a line), each "" becomes one quote. Only
  // called when the content holds a CR; counts the lines it passes onto `line`.
  function quotedContentSlow(content) {
    let out = '';
    let i = 0;
    const m = content.length;
    while (i < m) {
      const c = content.charCodeAt(i);
      if (c === 13) {
        out += '\n';
        line += 1;
        i += content.charCodeAt(i + 1) === 10 ? 2 : 1;
      } else if (c === 10) {
        out += '\n';
        line += 1;
        i += 1;
      } else if (c === 34) {
        out += '"';
        i += 2;
      } else {
        let j = i + 1;
        while (j < m) {
          const cc = content.charCodeAt(j);
          if (cc === 13 || cc === 10 || cc === 34) break;
          j += 1;
        }
        out += content.slice(i, j);
        i = j;
      }
    }
    return out;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let value = '';
    let ended = END;

    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        lastQuoted = true;
        const open = pos;
        // Find the closing quote: the next quote that is not doubled.
        let scan = open + 1;
        let close = -1;
        for (;;) {
          const q = text.indexOf('"', scan);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            scan = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text after it is read
          // again as unquoted. (The scan above never moved `line`, so nothing needs restoring.)
          errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
          scanUnquoted(open + 1);
          value = '"' + uValue;
          ended = uEnded;
          pos = uPos;
          if (ended === LINE_BREAK) line += 1;
        } else {
          const content = text.slice(open + 1, close);
          if (content.indexOf('\r') === -1) {
            // No CR inside: every LF in the content is one line, and "" unescapes in one pass.
            let k = content.indexOf('\n');
            while (k !== -1) {
              line += 1;
              k = content.indexOf('\n', k + 1);
            }
            value = content.indexOf('"') === -1 ? content : content.replaceAll('""', '"');
          } else {
            value = quotedContentSlow(content);
          }
          pos = close + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              scanUnquoted(pos);
              if (uAdded > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
              value += uValue;
              ended = uEnded;
              pos = uPos;
              if (ended === LINE_BREAK) line += 1;
            }
          }
        }
      } else {
        lastQuoted = false;
        // An unquoted field. (Two faster-looking shapes were measured and lost to this one on
        // the practice set: inlining this scan into the record loop, and jumping to the field's
        // end with indexOf — the LF search scans a whole line per field, not just the field.)
        scanUnquoted(pos);
        value = uValue;
        ended = uEnded;
        pos = uPos;
        if (ended === LINE_BREAK) line += 1;
      }
      fields.push(value);
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
