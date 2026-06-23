'use strict';

/**
 * Enforces the trip save invalidation contract: dashboard widget roots
 * (`tripKeys.unplannedRoot`, `tripKeys.timelessRuleTripsRoot`) must only be
 * invalidated via `invalidateAfterTripSave` in invalidate-after-trip-save.ts.
 *
 * WHY error (not warn): bypassing the helper is an invisible runtime bug — lint
 * must fail at commit time so the contract is enforceable without code review.
 */

const HELPER_FILENAME = 'invalidate-after-trip-save.ts';

const WIDGET_ROOT_PROPERTIES = new Set([
  'unplannedRoot',
  'timelessRuleTripsRoot'
]);

const WIDGET_SECOND_SEGMENTS = new Set(['unplanned', 'timeless-rules']);

function isStringLiteral(node, value) {
  return (
    node &&
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value === value
  );
}

/** Primary: tripKeys.unplannedRoot / tripKeys.timelessRuleTripsRoot member expressions. */
function isWidgetRootMemberExpression(node) {
  if (!node || node.type !== 'MemberExpression') {
    return false;
  }

  if (node.computed) {
    return false;
  }

  const property = node.property;
  return (
    property.type === 'Identifier' && WIDGET_ROOT_PROPERTIES.has(property.name)
  );
}

/** Fallback: inline ['trips', 'unplanned'] or ['trips', 'timeless-rules'] literals. */
function isWidgetRootArrayLiteral(node) {
  if (!node || node.type !== 'ArrayExpression') {
    return false;
  }

  const elements = node.elements;
  if (elements.length < 2) {
    return false;
  }

  const first = elements[0];
  const second = elements[1];

  if (!isStringLiteral(first, 'trips') || second?.type !== 'Literal') {
    return false;
  }

  return (
    typeof second.value === 'string' && WIDGET_SECOND_SEGMENTS.has(second.value)
  );
}

function isWidgetRootQueryKey(node) {
  return isWidgetRootMemberExpression(node) || isWidgetRootArrayLiteral(node);
}

function getQueryKeyFromInvalidateCall(node) {
  if (node.type !== 'CallExpression' || node.arguments.length === 0) {
    return null;
  }

  const callee = node.callee;
  if (
    callee.type !== 'MemberExpression' ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'invalidateQueries'
  ) {
    return null;
  }

  const firstArg = node.arguments[0];
  if (firstArg.type !== 'ObjectExpression') {
    return null;
  }

  for (const prop of firstArg.properties) {
    if (
      prop.type === 'Property' &&
      !prop.computed &&
      prop.key.type === 'Identifier' &&
      prop.key.name === 'queryKey'
    ) {
      return prop.value;
    }
  }

  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct widget root invalidation outside invalidate-after-trip-save.ts'
    },
    schema: [],
    messages: {
      noDirectWidgetInvalidation:
        'Direct widget root invalidation is not allowed outside invalidate-after-trip-save.ts. Use invalidateAfterTripSave() with includePlanningWidgets instead.'
    }
  },

  create(context) {
    const filename = context.getFilename();

    if (filename.endsWith(HELPER_FILENAME)) {
      return {};
    }

    return {
      CallExpression(node) {
        const queryKey = getQueryKeyFromInvalidateCall(node);
        if (!queryKey || !isWidgetRootQueryKey(queryKey)) {
          return;
        }

        context.report({
          node,
          messageId: 'noDirectWidgetInvalidation'
        });
      }
    };
  }
};
