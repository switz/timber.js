type MDXComponents = Record<string, (props: Record<string, unknown>) => React.ReactNode>;

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h1: (props) => <h1 className="text-3xl font-bold mt-8 mb-4" {...props} />,
    h2: (props) => <h2 className="text-2xl font-semibold mt-6 mb-3" {...props} />,
    h3: (props) => <h3 className="text-xl font-semibold mt-4 mb-2" {...props} />,
    pre: (props) => (
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto" {...props} />
    ),
    code: (props) => <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm" {...props} />,
    a: (props) => <a className="text-blue-600 underline" {...props} />,
  };
}
