/**
 * Escapes Discord markdown characters in a string.
 * This is useful for usernames or other user-generated content that should be displayed literally.
 * 
 * Escapes: \ * _ ~ | ` > # - [ ] ( )
 */
export function escapeMarkdown(text: string | null | undefined): string {
    if (!text) return text ?? '';
    return text.replace(/([\\*_~|`>#\-\[\]\(\)])/g, '\\$1');
}
