/**
 * Escape sequences that carry their own payload: OSC (`ESC ]`, ended by BEL or `ESC \`, used for hyperlinks, window
 * titles and clipboard writes), DCS, SOS, PM and APC. An unterminated one ends at the end of the line.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this module.
const STRING_SEQUENCE = /\u001b[\]PX^_][^\u0007\u001b\n]*(?:\u0007|\u001b\\)?/g;

/** CSI sequences (`ESC [ ... final byte`, colours and cursor moves) and any other two-byte escape. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this module.
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]?|[^\n])/g;

/** C0 controls except tab and newline (so BEL, CR, backspace, a lone ESC), DEL and the C1 range 0x80-0x9f. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this module.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Text from the network made safe to print: escape sequences and control characters are removed, newlines and tabs
 * stay. A fetched file could otherwise rewrite the terminal (hide lines, set the title, write the clipboard through
 * OSC 52, plant a link with OSC 8).
 */
export function stripTerminalControls(text: string): string {
    return text.replace(STRING_SEQUENCE, "").replace(ESCAPE_SEQUENCE, "").replace(CONTROL_CHARACTERS, "");
}
