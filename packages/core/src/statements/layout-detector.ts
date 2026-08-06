import { ExtractedTabularSheet } from "../tabular/tabular-types.js";
import { StatementLayoutProfile } from "./statement-types.js";

export interface LayoutMatch {
  profileId: string;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedHeaders: string[];
  missingRequiredGroups: string[][];
  headerRowIndex: number;
}

export function detectLayout(
  sheet: ExtractedTabularSheet,
  profiles: StatementLayoutProfile[],
  sourceFormat: any
): LayoutMatch | null {
  let bestMatch: LayoutMatch | null = null;
  
  for (const profile of profiles) {
     if (!profile.formats.includes(sourceFormat)) continue;
     
     if (profile.detection.negativeSheetNames?.some(n => sheet.name.toLowerCase().includes(n.toLowerCase()))) {
       continue;
     }

     const scanLimit = Math.min(sheet.rows.length, profile.rules.headerScanRows || 50);
     let matchedHeaders: string[] = [];
     let missingRequiredGroups: string[][] = profile.detection.requiredHeaderGroups;
     let score = 0;
     let foundHeaderRowIndex = -1;
     
     for (let r = 0; r < scanLimit; r++) {
       const row = sheet.rows[r];
       if (!row) continue;
       const textRow = row.cells.map(c => c.displayValue.toLowerCase().trim());
       
       const remainingGroups = [];
       let rowMatches = 0;
       const newMatchedHeaders = [];

       for (const group of missingRequiredGroups) {
          const match = group.find(alias => textRow.includes(alias.toLowerCase()));
          if (match) {
             newMatchedHeaders.push(match);
             rowMatches++;
          } else {
             remainingGroups.push(group);
          }
       }

       if (rowMatches > 0) {
         matchedHeaders.push(...newMatchedHeaders);
         score += (rowMatches * 20);
         missingRequiredGroups = remainingGroups;
         
         if (foundHeaderRowIndex === -1) {
            foundHeaderRowIndex = r;
         }
       }

       if (missingRequiredGroups.length === 0) break;
     }
     
     if (profile.detection.sheetNameAliases?.some(n => sheet.name.toLowerCase().includes(n.toLowerCase()))) {
       score += 30;
     }

     if (score >= profile.detection.minimumScore && missingRequiredGroups.length === 0) {
        if (!bestMatch || score > bestMatch.score) {
           bestMatch = {
             profileId: profile.id,
             score,
             confidence: score > 80 ? "HIGH" : "MEDIUM",
             matchedHeaders,
             missingRequiredGroups,
             headerRowIndex: foundHeaderRowIndex
           };
        }
     }
  }

  return bestMatch;
}
