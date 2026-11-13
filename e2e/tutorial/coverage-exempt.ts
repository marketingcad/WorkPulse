/**
 * Labels a scene's narration names that the coverage check (timing/coverage.ts) should not ask to be
 * shown, each with the reason. Keep this short: the rule is that the video shows what the voice names.
 * Things that cannot be shown on screen (an operating system, a phone) wait for the motion-graphics
 * layer, and are listed here until then.
 */
export const NOT_SHOWN: Record<string, Record<string, string>> = {
  '11.3': { Finance: 'Said only as the general word in "Like every finance list", at the end; the Finance menu step comes at the start of the scene.' },
  '06.5': { Breaks: 'The first "breaks" is the general phrase "you can plan breaks", before the project is open; the Breaks section is shown when named ("In the Breaks section").' },
};
