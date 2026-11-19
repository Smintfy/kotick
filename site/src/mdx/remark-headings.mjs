import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';

export default function remarkHeadings() {
  return (tree) => {
    const slugger = new GithubSlugger();
    const headings = [];
    const links = [];

    const walk = (node) => {
      if (node.type === 'heading') {
        const text = toString(node);
        const id = slugger.slug(text);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };

        if (node.depth === 2 || node.depth === 3) headings.push({ id, text, depth: node.depth });
      }

      if (node.type === 'link' && node.url.startsWith('/')) links.push(node.url);

      for (const child of node.children ?? []) walk(child);
    };

    walk(tree);
    tree.children.push(
      exportConst('headings', array(headings.map(object))),
      exportConst('links', array(links.map(literal))),
    );
  };
}

function exportConst(name, init) {
  const declaration = {
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [{ type: 'VariableDeclarator', id: { type: 'Identifier', name }, init }],
  };

  return {
    type: 'mdxjsEsm',
    value: '',
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        body: [{ type: 'ExportNamedDeclaration', declaration, specifiers: [], source: null }],
      },
    },
  };
}

const literal = (value) => ({ type: 'Literal', value });

const array = (elements) => ({ type: 'ArrayExpression', elements });

const object = (fields) => ({
  type: 'ObjectExpression',
  properties: Object.entries(fields).map(([key, value]) => ({
    type: 'Property',
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
    key: { type: 'Identifier', name: key },
    value: literal(value),
  })),
});
