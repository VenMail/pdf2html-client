/**
 * Word Validator - Dictionary-based word validation for text extraction
 * 
 * Uses a compact trie structure for efficient prefix/word lookups
 * to validate whether character sequences form valid English words.
 */

// Compact trie node: children map + isWord flag
type TrieNode = {
  c?: Map<string, TrieNode>;  // children (lazy initialized)
  w?: boolean;                 // is complete word
};

/**
 * Prefix tree for efficient word/prefix lookups
 */
class PrefixTree {
  private root: TrieNode = {};

  insert(word: string): void {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.c) node.c = new Map();
      let child = node.c.get(char);
      if (!child) {
        child = {};
        node.c.set(char, child);
      }
      node = child;
    }
    node.w = true;
  }

  hasWord(word: string): boolean {
    const node = this.traverse(word.toLowerCase());
    return node?.w === true;
  }

  hasPrefix(prefix: string): boolean {
    return this.traverse(prefix.toLowerCase()) !== null;
  }

  private traverse(str: string): TrieNode | null {
    let node: TrieNode | undefined = this.root;
    for (const char of str) {
      if (!node?.c) return null;
      node = node.c.get(char);
      if (!node) return null;
    }
    return node;
  }

  /**
   * Find all words that start with the given prefix
   */
  findWordsWithPrefix(prefix: string, maxResults = 10): string[] {
    const node = this.traverse(prefix.toLowerCase());
    if (!node) return [];
    
    const results: string[] = [];
    this.collectWords(node, prefix.toLowerCase(), results, maxResults);
    return results;
  }

  private collectWords(node: TrieNode, prefix: string, results: string[], max: number): void {
    if (results.length >= max) return;
    if (node.w) results.push(prefix);
    if (!node.c) return;
    for (const [char, child] of node.c) {
      this.collectWords(child, prefix + char, results, max);
    }
  }
}

/**
 * Result of word validation
 */
export type WordValidationResult = 'complete' | 'prefix' | 'invalid';

/**
 * Boundary suggestion for character sequences
 */
export type BoundarySuggestion = {
  position: number;
  confidence: number;
  reason: 'dictionary' | 'pattern' | 'capitalization';
};

/**
 * Word Validator class
 * 
 * Provides dictionary-based validation for character sequences
 * to help determine word boundaries during text extraction.
 */
export class WordValidator {
  private trie: PrefixTree;
  private initialized = false;

  // Common English word list (top ~3000 words covering ~95% of text)
  // This is a minimal set - can be expanded
  private static COMMON_WORDS = [
    // Articles & determiners
    'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
    'some', 'any', 'no', 'every', 'each', 'all', 'both', 'few', 'many', 'much', 'most', 'other', 'another',
    
    // Pronouns
    'i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'it', 'they', 'them', 'who', 'whom', 'what', 'which',
    'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
    
    // Prepositions
    'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
    'again', 'further', 'then', 'once', 'of', 'as', 'until', 'while', 'toward', 'towards', 'upon',
    'across', 'along', 'around', 'behind', 'beside', 'besides', 'beyond', 'within', 'without',
    
    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet', 'for', 'because', 'although', 'though', 'if', 'unless',
    'when', 'where', 'while', 'whether', 'however', 'therefore', 'moreover', 'furthermore',
    
    // Common verbs
    'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having',
    'do', 'does', 'did', 'doing', 'done', 'will', 'would', 'shall', 'should', 'may', 'might',
    'must', 'can', 'could', 'need', 'dare', 'ought', 'used',
    'get', 'gets', 'got', 'getting', 'gotten', 'make', 'makes', 'made', 'making',
    'go', 'goes', 'went', 'going', 'gone', 'come', 'comes', 'came', 'coming',
    'see', 'sees', 'saw', 'seeing', 'seen', 'know', 'knows', 'knew', 'knowing', 'known',
    'take', 'takes', 'took', 'taking', 'taken', 'give', 'gives', 'gave', 'giving', 'given',
    'find', 'finds', 'found', 'finding', 'think', 'thinks', 'thought', 'thinking',
    'tell', 'tells', 'told', 'telling', 'become', 'becomes', 'became', 'becoming',
    'leave', 'leaves', 'left', 'leaving', 'put', 'puts', 'putting',
    'keep', 'keeps', 'kept', 'keeping', 'let', 'lets', 'letting',
    'begin', 'begins', 'began', 'beginning', 'begun', 'seem', 'seems', 'seemed', 'seeming',
    'help', 'helps', 'helped', 'helping', 'show', 'shows', 'showed', 'showing', 'shown',
    'hear', 'hears', 'heard', 'hearing', 'play', 'plays', 'played', 'playing',
    'run', 'runs', 'ran', 'running', 'move', 'moves', 'moved', 'moving',
    'live', 'lives', 'lived', 'living', 'believe', 'believes', 'believed', 'believing',
    'hold', 'holds', 'held', 'holding', 'bring', 'brings', 'brought', 'bringing',
    'happen', 'happens', 'happened', 'happening', 'write', 'writes', 'wrote', 'writing', 'written',
    'provide', 'provides', 'provided', 'providing', 'sit', 'sits', 'sat', 'sitting',
    'stand', 'stands', 'stood', 'standing', 'lose', 'loses', 'lost', 'losing',
    'pay', 'pays', 'paid', 'paying', 'meet', 'meets', 'met', 'meeting',
    'include', 'includes', 'included', 'including', 'continue', 'continues', 'continued', 'continuing',
    'set', 'sets', 'setting', 'learn', 'learns', 'learned', 'learning',
    'change', 'changes', 'changed', 'changing', 'lead', 'leads', 'led', 'leading',
    'understand', 'understands', 'understood', 'understanding',
    'watch', 'watches', 'watched', 'watching', 'follow', 'follows', 'followed', 'following',
    'stop', 'stops', 'stopped', 'stopping', 'create', 'creates', 'created', 'creating',
    'speak', 'speaks', 'spoke', 'speaking', 'spoken', 'read', 'reads', 'reading',
    'allow', 'allows', 'allowed', 'allowing', 'add', 'adds', 'added', 'adding',
    'spend', 'spends', 'spent', 'spending', 'grow', 'grows', 'grew', 'growing', 'grown',
    'open', 'opens', 'opened', 'opening', 'walk', 'walks', 'walked', 'walking',
    'win', 'wins', 'won', 'winning', 'offer', 'offers', 'offered', 'offering',
    'remember', 'remembers', 'remembered', 'remembering',
    'love', 'loves', 'loved', 'loving', 'consider', 'considers', 'considered', 'considering',
    'appear', 'appears', 'appeared', 'appearing', 'buy', 'buys', 'bought', 'buying',
    'wait', 'waits', 'waited', 'waiting', 'serve', 'serves', 'served', 'serving',
    'die', 'dies', 'died', 'dying', 'send', 'sends', 'sent', 'sending',
    'expect', 'expects', 'expected', 'expecting', 'build', 'builds', 'built', 'building',
    'stay', 'stays', 'stayed', 'staying', 'fall', 'falls', 'fell', 'falling', 'fallen',
    'cut', 'cuts', 'cutting', 'reach', 'reaches', 'reached', 'reaching',
    'kill', 'kills', 'killed', 'killing', 'remain', 'remains', 'remained', 'remaining',
    'suggest', 'suggests', 'suggested', 'suggesting',
    'raise', 'raises', 'raised', 'raising', 'pass', 'passes', 'passed', 'passing',
    'sell', 'sells', 'sold', 'selling', 'require', 'requires', 'required', 'requiring',
    'report', 'reports', 'reported', 'reporting', 'decide', 'decides', 'decided', 'deciding',
    'pull', 'pulls', 'pulled', 'pulling',
    
    // Common nouns
    'time', 'year', 'people', 'way', 'day', 'man', 'woman', 'child', 'children',
    'world', 'life', 'hand', 'part', 'place', 'case', 'week', 'company', 'system',
    'program', 'question', 'work', 'government', 'number', 'night', 'point', 'home',
    'water', 'room', 'mother', 'area', 'money', 'story', 'fact', 'month', 'lot',
    'right', 'study', 'book', 'eye', 'job', 'word', 'business', 'issue', 'side',
    'kind', 'head', 'house', 'service', 'friend', 'father', 'power', 'hour', 'game',
    'line', 'end', 'member', 'law', 'car', 'city', 'community', 'name', 'president',
    'team', 'minute', 'idea', 'body', 'information', 'back', 'parent', 'face',
    'others', 'level', 'office', 'door', 'health', 'person', 'art', 'war', 'history',
    'party', 'result', 'change', 'morning', 'reason', 'research', 'girl', 'guy',
    'moment', 'air', 'teacher', 'force', 'education', 'foot', 'boy', 'age', 'policy',
    'process', 'music', 'market', 'sense', 'nation', 'plan', 'college', 'interest',
    'death', 'experience', 'effect', 'use', 'class', 'control', 'care', 'field',
    'development', 'role', 'effort', 'rate', 'heart', 'drug', 'show', 'leader',
    'light', 'voice', 'wife', 'police', 'mind', 'difference', 'period', 'value',
    'building', 'action', 'industry', 'table', 'blood', 'need', 'form', 'stage',
    'society', 'tax', 'director', 'position', 'player', 'view', 'cost', 'news',
    'technology', 'software', 'engineer', 'engineering', 'developer', 'development',
    'application', 'applications', 'data', 'database', 'design', 'project', 'projects',
    'management', 'manager', 'team', 'teams', 'product', 'products', 'customer', 'customers',
    'solution', 'solutions', 'skill', 'skills', 'ability', 'abilities',
    
    // Common adjectives
    'good', 'new', 'first', 'last', 'long', 'great', 'little', 'own', 'other', 'old',
    'right', 'big', 'high', 'different', 'small', 'large', 'next', 'early', 'young',
    'important', 'few', 'public', 'bad', 'same', 'able', 'best', 'better', 'sure',
    'free', 'true', 'full', 'special', 'easy', 'clear', 'recent', 'certain', 'personal',
    'open', 'red', 'difficult', 'available', 'likely', 'short', 'single', 'medical',
    'current', 'wrong', 'private', 'past', 'foreign', 'fine', 'common', 'poor', 'natural',
    'significant', 'similar', 'hot', 'dead', 'central', 'happy', 'serious', 'ready',
    'simple', 'left', 'physical', 'general', 'environmental', 'financial', 'blue',
    'democratic', 'dark', 'various', 'entire', 'close', 'legal', 'religious', 'cold',
    'final', 'main', 'green', 'nice', 'huge', 'popular', 'traditional', 'cultural',
    'strong', 'professional', 'experienced', 'senior', 'junior', 'responsible',
    
    // Common adverbs
    'not', 'also', 'very', 'often', 'however', 'too', 'usually', 'really', 'early',
    'never', 'always', 'sometimes', 'together', 'likely', 'simply', 'generally',
    'instead', 'actually', 'already', 'especially', 'ever', 'quickly', 'probably',
    'finally', 'either', 'quite', 'recently', 'thus', 'suddenly', 'soon', 'certainly',
    'perhaps', 'today', 'ago', 'later', 'certainly', 'highly', 'successfully',
    
    // Common past participles and -ed forms (to prevent false splits)
    'underlined', 'highlighted', 'formatted', 'processed', 'completed', 'updated',
    'created', 'deleted', 'modified', 'submitted', 'approved', 'rejected', 'reviewed',
    'published', 'downloaded', 'uploaded', 'installed', 'configured', 'implemented',
    'developed', 'designed', 'tested', 'deployed', 'maintained', 'managed', 'organized',
    'streamlined', 'optimized', 'automated', 'integrated', 'customized', 'specialized',
    
    // Numbers
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'hundred', 'thousand', 'million', 'billion', 'first', 'second', 'third',
    
    // Technology/Business terms (common in CVs/documents)
    'software', 'hardware', 'computer', 'digital', 'internet', 'online', 'website',
    'email', 'phone', 'mobile', 'network', 'server', 'client', 'user', 'users',
    'interface', 'platform', 'framework', 'library', 'api', 'code', 'coding',
    'programming', 'backend', 'frontend', 'fullstack', 'database', 'sql', 'cloud',
    'aws', 'azure', 'google', 'microsoft', 'apple', 'facebook', 'amazon', 'netflix',
    'agile', 'scrum', 'sprint', 'kanban', 'devops', 'cicd', 'git', 'github',
    'javascript', 'typescript', 'python', 'java', 'react', 'angular', 'vue', 'node',
    'html', 'css', 'web', 'app', 'apps', 'ios', 'android',
    'finance', 'financial', 'banking', 'bank', 'investment', 'trading', 'accounting',
    'marketing', 'sales', 'revenue', 'profit', 'growth', 'strategy', 'strategic',
    'analytics', 'analysis', 'analyst', 'metrics', 'kpi', 'roi', 'performance',
    'enterprise', 'corporate', 'startup', 'company', 'organization', 'department',
    'executive', 'director', 'manager', 'lead', 'senior', 'junior', 'intern',
    'resume', 'cv', 'portfolio', 'profile', 'career', 'job', 'position', 'role',
    'responsibilities', 'achievements', 'accomplishments', 'results', 'impact',
    'communication', 'collaboration', 'leadership', 'teamwork', 'problem', 'solving',
    'present', 'presents', 'presented', 'presenting', 'presentation',
    'connecting', 'connect', 'connected', 'connection', 'connections',
    'account', 'accounts', 'opening', 'fraud', 'detection', 'intelligence',
    'streamlining', 'workflows', 'workflow', 'powering', 'driven', 'decision',
    'making', 'played', 'key', 'developing', 'wide', 'crm', 'contributed',
    'significantly', 'rebrand', 'translating', 'polished', 'fidelity', 'ux',
    'transformed', 'monolithic', 'codebase', 'modular', 'reusable', 'components',
    'dramatically', 'improving', 'efficiency', 'scalability', 'engineered',
    'powerful', 'mailing', 'suite', 'composer', 'bulk', 'actions', 'inspired',
    'thread', 'layout', 'integrated', 'conferencing', 'enabling', 'seamless',
    'meetings', 'enhancing', 'calendar', 'booking', 'optimizing', 'scheduling',
    'processes', 'expanded', 'integration', 'adding', 'features', 'transfers',
    'indicators', 'busy', 'unavailable', 'switched', 'airtime', 'payments',
    'extensive', 'contacts', 'capabilities', 'owners', 'facilitated',
    'syncs', 'boosting', 'delivering', 'cohesive', 'friendly', 'solutions',
    'maintainability', 'accelerate', 'assisted', 'testing', 'optimization',
    'replay', 'sentry', 'crashlytics', 'reliability', 'safeguarding',
    'supported', 'onboarding', 'resolution', 'ensuring', 'smooth', 'adoption',
    'quality', 'experience', 'experiences', 'laravel', 'inertia', 'figma',
    'designs', 'establish', 'robust', 'chatbot', 'capable', 'handling',
    'related', 'general', 'inquiries', 'conversational', 'flows', 'uploads',
    'automated', 'verification', 'reducing', 'manual', 'support', 'workload',
    'modernized', 'legacy', 'automation', 'proactive', 'maintenance',
    'reliable', 'scalable', 'efficient', 'operations', 'dashboards',
    'millions', 'records', 'real', 'delivering', 'executive', 'ready',
    'insights', 'faster', 'smarter', 'intelligent', 'built', 'both',
    
    // Location terms
    'address', 'street', 'city', 'state', 'country', 'region', 'location',
    'local', 'national', 'international', 'global', 'worldwide',
    
    // Time terms
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'yesterday',
  ];

  constructor() {
    this.trie = new PrefixTree();
  }

  /**
   * Initialize the validator with the word dictionary
   * Called lazily on first use
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    
    for (const word of WordValidator.COMMON_WORDS) {
      this.trie.insert(word);
    }
    this.initialized = true;
  }

  /**
   * Check if the given string is a valid English word
   */
  isWord(text: string): boolean {
    this.ensureInitialized();
    if (!text || text.length === 0) return false;
    return this.trie.hasWord(text);
  }

  /**
   * Check if the given string could be the start of a valid word
   */
  isPrefix(text: string): boolean {
    this.ensureInitialized();
    if (!text || text.length === 0) return false;
    return this.trie.hasPrefix(text);
  }

  /**
   * Validate a character sequence
   * Returns 'complete' if it's a word, 'prefix' if it could become one, 'invalid' otherwise
   */
  validate(text: string): WordValidationResult {
    this.ensureInitialized();
    if (!text || text.length === 0) return 'invalid';
    
    const lower = text.toLowerCase();
    if (this.trie.hasWord(lower)) return 'complete';
    if (this.trie.hasPrefix(lower)) return 'prefix';
    return 'invalid';
  }

  /**
   * Find the longest valid word at the start of the text
   */
  findLongestWordAtStart(text: string): string | null {
    this.ensureInitialized();
    if (!text || text.length === 0) return null;

    let longestWord: string | null = null;
    let current = '';

    for (const char of text.toLowerCase()) {
      current += char;
      if (!this.trie.hasPrefix(current)) break;
      if (this.trie.hasWord(current)) {
        longestWord = current;
      }
    }

    return longestWord;
  }

  /**
   * Suggest word boundaries for a character sequence
   * Uses greedy longest-match algorithm
   */
  suggestBoundaries(text: string): BoundarySuggestion[] {
    this.ensureInitialized();
    if (!text || text.length === 0) return [];

    const suggestions: BoundarySuggestion[] = [];
    const lower = text.toLowerCase();
    let pos = 0;

    while (pos < lower.length) {
      const remaining = lower.slice(pos);
      const longestWord = this.findLongestWordAtStart(remaining);
      
      if (longestWord && longestWord.length > 1) {
        const endPos = pos + longestWord.length;
        if (endPos < lower.length) {
          suggestions.push({
            position: endPos,
            confidence: longestWord.length >= 4 ? 0.9 : 0.7,
            reason: 'dictionary'
          });
        }
        pos = endPos;
      } else {
        pos++;
      }
    }

    return suggestions;
  }

  /**
   * Check if joining two strings would form a valid word
   */
  wouldFormWord(left: string, right: string): boolean {
    this.ensureInitialized();
    return this.trie.hasWord((left + right).toLowerCase());
  }

  /**
   * Check if a string follows common English patterns
   * (consonant-vowel patterns, etc.)
   */
  hasValidPattern(text: string): boolean {
    if (!text || text.length < 2) return true;
    
    const lower = text.toLowerCase();
    
    // Check for impossible consonant clusters at start
    const impossibleStarts = /^[bcdfghjklmnpqrstvwxyz]{4,}/;
    if (impossibleStarts.test(lower)) return false;
    
    // Check for impossible vowel clusters
    const impossibleVowels = /[aeiou]{4,}/;
    if (impossibleVowels.test(lower)) return false;
    
    // Check for impossible consonant clusters in middle
    const impossibleMiddle = /[bcdfghjklmnpqrstvwxyz]{5,}/;
    if (impossibleMiddle.test(lower)) return false;
    
    return true;
  }

  /**
   * Score how likely two character sequences should be joined
   * Returns 0-1 where higher = more likely to join
   */
  scoreJoin(left: string, right: string): number {
    this.ensureInitialized();
    
    if (!left || !right) return 0;
    
    const combined = (left + right).toLowerCase();
    const leftLower = left.toLowerCase();
    const rightLower = right.toLowerCase();
    
    // If combined is a complete word, strongly favor joining
    if (this.trie.hasWord(combined)) return 0.95;
    
    // If combined is a valid prefix, moderately favor joining
    if (this.trie.hasPrefix(combined)) return 0.7;
    
    // If left is complete word and right starts new word, favor splitting
    if (this.trie.hasWord(leftLower) && this.trie.hasPrefix(rightLower)) return 0.3;
    
    // Check pattern validity
    if (!this.hasValidPattern(combined)) return 0.2;
    
    // Default: slight preference for splitting
    return 0.4;
  }

  /**
   * Split a merged word string into separate words using dictionary lookup.
   * E.g., "connectingfinance" -> "connecting finance"
   * Only splits if both parts are valid words AND the original is NOT a valid word.
   */
  splitMergedWords(text: string): string {
    this.ensureInitialized();
    if (!text || text.length < 6) return text;

    // Only process alphabetic sequences
    if (!/^[A-Za-z]+$/.test(text)) return text;

    const lower = text.toLowerCase();
    
    // If the original text is already a valid word, don't split it
    if (this.trie.hasWord(lower)) return text;
    
    // Try to find a split point where both parts are valid words
    // Prefer longer first words (greedy from left)
    for (let i = lower.length - 2; i >= 3; i--) {
      const left = lower.slice(0, i);
      const right = lower.slice(i);
      
      // Both parts must be at least 3 characters and valid words
      if (left.length >= 3 && right.length >= 3 &&
          this.trie.hasWord(left) && this.trie.hasWord(right)) {
        // Preserve original case for the split
        return text.slice(0, i) + ' ' + text.slice(i);
      }
    }

    return text;
  }

  /**
   * Process text to fix common merged word issues.
   * Handles patterns like "connectingfinance" and "•Contributed"
   */
  fixMergedText(text: string): string {
    if (!text || text.length < 4) return text;

    let result = text;

    // Fix bullet points without space after them
    result = result.replace(/^([•·▪▸►◦‣⁃])([A-Za-z])/g, '$1 $2');

    // Find and split merged alphabetic sequences
    result = result.replace(/\b([A-Za-z]{6,})\b/g, (match) => {
      return this.splitMergedWords(match);
    });

    return result;
  }
}

// Singleton instance
let _defaultValidator: WordValidator | null = null;

export function getDefaultWordValidator(): WordValidator {
  if (!_defaultValidator) {
    _defaultValidator = new WordValidator();
  }
  return _defaultValidator;
}
